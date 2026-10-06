"""Restart only development servers from this exact Nexora checkout.

Windows can report an exited reloader's PID for an inherited listening socket.
An orphan worker requires the reported parent PID, matching cwd, Python spawn
command, and Nexora health response. Never terminate an arbitrary port owner.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.request import ProxyHandler, build_opener

try:
    import psutil
except ImportError:
    print(json.dumps({"error": "Missing launcher dependency. Run: .\\.venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt"}))
    raise SystemExit(2)


class LauncherError(RuntimeError):
    pass


def same_path(left, right):
    return os.path.normcase(os.path.realpath(left)) == os.path.normcase(os.path.realpath(right))


def process_matches(process, project, kind, allow_worker=False):
    try:
        expected = project if kind == "backend" else project / "frontend"
        if not same_path(process.cwd(), expected):
            return False
        name, args = process.name().lower(), process.cmdline()
        if kind == "frontend":
            return name in {"node.exe", "node"} and not any(arg in {"-e", "--eval"} for arg in args) and any(
                re.search(r"(?:^|[/\\])vite(?:[/\\]bin[/\\]vite\.js)?$", arg, re.I)
                for arg in args[1:]
            )
        if not name.startswith("python"):
            return False
        direct = "backend.main:app" in args and (
            "uvicorn" in args or any(Path(arg).name.lower() in {"uvicorn", "uvicorn.exe"} for arg in args)
        )
        worker = allow_worker and "--multiprocessing-fork" in args and any(
            "from multiprocessing.spawn import spawn_main" in arg for arg in args
        )
        return direct or worker
    except (psutil.Error, OSError):
        return False


def nexora_healthy(port):
    try:
        with build_opener(ProxyHandler({})).open(f"http://127.0.0.1:{port}/health", timeout=1) as response:
            health = json.loads(response.read(4096))
        return isinstance(health, dict) and health.get("status") == "ok" and health.get("service") == "deep-research-agent"
    except (OSError, ValueError):
        return False


def listener_pids(port):
    try:
        connections = psutil.net_connections(kind="tcp")
    except psutil.Error as error:
        raise LauncherError("Cannot inspect listening ports. No process was stopped.") from error
    return {connection.pid for connection in connections
            if connection.status == psutil.CONN_LISTEN and connection.laddr.port == port}


def record(process, kind, port=None, orphan=False):
    return {"pid": process.pid, "created": process.create_time(), "kind": kind,
            "port": port, "orphan_worker": orphan}


def inspect_listener(project, port, kind):
    targets = {}
    for owner in listener_pids(port):
        if not owner:
            raise LauncherError(f"Port {port} has an unidentified listener. No process was stopped.")
        try:
            process = psutil.Process(owner)
            if not process_matches(process, project, kind, allow_worker=kind == "backend"):
                raise LauncherError(f"Port {port} is not owned by this Nexora checkout (PID {owner}). No process was stopped.")
            if kind == "backend":
                if not process_matches(process, project, kind) and not nexora_healthy(port):
                    raise LauncherError(f"Port {port} belongs to a Python worker, but Nexora health could not be verified. No process was stopped.")
                # Never ascend to a terminal or a different checkout.
                for _ in range(3):
                    parent = process.parent()
                    if not parent or not process_matches(parent, project, kind):
                        break
                    process = parent
            targets[process.pid] = record(process, kind, port, orphan=not process_matches(process, project, kind))
        except psutil.NoSuchProcess:
            if kind != "backend" or not nexora_healthy(port):
                raise LauncherError(f"Port {port} reports an exited PID {owner}, but no verified Nexora worker was found. No process was stopped.")
            candidates = []
            for candidate in psutil.process_iter():
                try:
                    if candidate.ppid() == owner and process_matches(candidate, project, kind, allow_worker=True):
                        candidates.append(candidate)
                except psutil.Error:
                    continue
            if not candidates:
                raise LauncherError(f"Port {port} reports an exited PID {owner}. Cannot safely identify its worker. No process was stopped.")
            for candidate in candidates:
                targets[candidate.pid] = record(candidate, kind, port, orphan=True)
        except psutil.AccessDenied as error:
            raise LauncherError(f"Cannot inspect PID {owner} on port {port}. No process was stopped.") from error
    return list(targets.values())


def inspect_servers(project):
    # Validate BOTH before stopping either server.
    return inspect_listener(project, 8000, "backend") + inspect_listener(project, 5173, "frontend")


def stop_owned(project, target):
    try:
        process = psutil.Process(target["pid"])
        if abs(process.create_time() - target["created"]) > 0.001:
            raise LauncherError("Process identity changed since inspection. No process was stopped.")
        if not process_matches(process, project, target["kind"], allow_worker=target.get("orphan_worker", False)):
            raise LauncherError("Process no longer matches this checkout. No process was stopped.")
        if target.get("port") is not None:
            confirmed = inspect_listener(project, target["port"], target["kind"])
            if not any(item["pid"] == process.pid and abs(item["created"] - target["created"]) < 0.001 for item in confirmed):
                raise LauncherError("Listener identity changed since inspection. No process was stopped.")
        children = [child for child in process.children(recursive=True)
                    if process_matches(child, project, target["kind"], allow_worker=True)]
        # psutil retains creation identity for terminate/kill (PID-reuse guard).
        process.terminate()
        for child in children:
            try:
                child.terminate()
            except psutil.NoSuchProcess:
                pass
        _, alive = psutil.wait_procs([process, *children], timeout=3)
        for survivor in alive:
            if process_matches(survivor, project, target["kind"], allow_worker=True):
                survivor.kill()
        _, alive = psutil.wait_procs(alive, timeout=2)
        if alive:
            raise LauncherError("An owned server did not stop. No unrelated process was stopped.")
    except psutil.NoSuchProcess:
        return
    except psutil.AccessDenied as error:
        raise LauncherError("Windows denied stopping the verified Nexora process.") from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("action", choices=["inspect", "stop", "record", "cleanup"])
    parser.add_argument("--pid", type=int)
    parser.add_argument("--created", type=float)
    parser.add_argument("--kind", choices=["backend", "frontend"])
    parser.add_argument("--port", type=int)
    parser.add_argument("--orphan", action="store_true")
    args = parser.parse_args()
    project = args.project.resolve()
    try:
        if args.action == "inspect":
            result = {"targets": inspect_servers(project)}
        elif args.action == "record":
            process = psutil.Process(args.pid)
            if not process_matches(process, project, args.kind):
                raise LauncherError("Started process could not be identified as this checkout's server.")
            result = record(process, args.kind)
        else:
            if args.pid is None or args.created is None or args.kind is None:
                raise LauncherError("Stopping requires the inspected PID, creation time and server kind.")
            target = {"pid": args.pid, "created": args.created, "kind": args.kind,
                      "port": args.port if args.action == "stop" else None, "orphan_worker": args.orphan}
            stop_owned(project, target)
            if args.action == "stop":
                for _ in range(20):
                    if not listener_pids(args.port):
                        break
                    time.sleep(0.2)
                else:
                    raise LauncherError(f"Port {args.port} is still occupied after stopping this checkout's server.")
            result = {"stopped": args.pid}
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except (LauncherError, psutil.Error, OSError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
