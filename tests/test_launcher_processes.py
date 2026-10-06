"""Launcher ownership and PID-reuse regressions; no real process is stopped."""
from pathlib import Path
from types import SimpleNamespace

import psutil
import pytest

from scripts import launcher_processes as launcher


@pytest.fixture
def project(tmp_path):
    return tmp_path / "nexora"


class Process:
    def __init__(self, pid, cwd, cmd, name="python3.11.exe", parent=None, created=100.25):
        self.pid, self._cwd, self._cmd = pid, cwd, cmd
        self._name, self._parent, self._created = name, parent, created
        self.stopped = False
        self.killed = False
        self._children = []

    def cwd(self): return str(self._cwd)
    def cmdline(self): return self._cmd
    def name(self): return self._name
    def create_time(self): return self._created
    def parent(self): return self._parent if isinstance(self._parent, Process) else None
    def ppid(self): return self._parent.pid if isinstance(self._parent, Process) else self._parent
    def children(self, recursive=False): return self._children
    def terminate(self): self.stopped = True
    def kill(self): self.killed = True


def backend(project, pid=42, **kwargs):
    return Process(pid, project, ["python.exe", "-m", "uvicorn", "backend.main:app", "--reload"], **kwargs)


def worker(project, pid=43, parent=42):
    return Process(pid, project, ["python.exe", "-c", "from multiprocessing.spawn import spawn_main; spawn_main(parent_pid=42)", "--multiprocessing-fork"], parent=parent)


def install_processes(monkeypatch, processes):
    by_pid = {process.pid: process for process in processes}
    def get_process(pid):
        if pid not in by_pid: raise psutil.NoSuchProcess(pid)
        return by_pid[pid]
    monkeypatch.setattr(launcher.psutil, "Process", get_process)
    monkeypatch.setattr(launcher.psutil, "process_iter", lambda: iter(processes))


def test_relative_vite_command_is_owned_only_in_exact_frontend(project):
    process = Process(45, project / "frontend", ["node.exe", "node_modules/vite/bin/vite.js", "--port", "5173"], name="node.exe")
    assert launcher.process_matches(process, project, "frontend")
    assert not launcher.process_matches(process, project.parent / "other", "frontend")
    process._cmd = ["node.exe", "-e", "vite"]
    assert not launcher.process_matches(process, project, "frontend")


def test_same_command_from_different_checkout_is_never_owned(project):
    assert not launcher.process_matches(backend(project.parent / "other"), project, "backend")
    assert not launcher.process_matches(Process(44, project, ["python.exe", "worker.py"]), project, "backend")


def test_orphan_worker_requires_explicit_permission(project):
    assert launcher.process_matches(worker(project), project, "backend", allow_worker=True)
    assert not launcher.process_matches(worker(project), project, "backend")


def test_orphan_inherited_socket_recovers_by_parent_cwd_and_health(project, monkeypatch):
    orphan = worker(project)
    unrelated = worker(project.parent / "other", pid=44)
    install_processes(monkeypatch, [orphan, unrelated])
    monkeypatch.setattr(launcher, "listener_pids", lambda port: {42})
    monkeypatch.setattr(launcher, "nexora_healthy", lambda port: True)
    assert launcher.inspect_listener(project, 8000, "backend") == [launcher.record(orphan, "backend", 8000, orphan=True)]
    assert not orphan.stopped and not unrelated.stopped


@pytest.mark.parametrize("healthy, matching_parent", [(False, True), (True, False)])
def test_orphan_fallback_fails_closed(project, monkeypatch, healthy, matching_parent):
    orphan = worker(project, parent=42 if matching_parent else 99)
    install_processes(monkeypatch, [orphan])
    monkeypatch.setattr(launcher, "listener_pids", lambda port: {42})
    monkeypatch.setattr(launcher, "nexora_healthy", lambda port: healthy)
    with pytest.raises(launcher.LauncherError): launcher.inspect_listener(project, 8000, "backend")
    assert not orphan.stopped


def test_live_reload_child_selects_own_supervisor_not_terminal(project, monkeypatch):
    terminal = Process(41, project, ["powershell.exe"], name="powershell.exe")
    supervisor = backend(project, parent=terminal)
    child = worker(project, parent=supervisor)
    install_processes(monkeypatch, [terminal, supervisor, child])
    monkeypatch.setattr(launcher, "listener_pids", lambda port: {child.pid})
    monkeypatch.setattr(launcher, "nexora_healthy", lambda port: True)
    targets = launcher.inspect_listener(project, 8000, "backend")
    assert [target["pid"] for target in targets] == [supervisor.pid]
    assert not targets[0]["orphan_worker"]


def test_live_detached_worker_keeps_worker_permission(project, monkeypatch):
    orphan = worker(project)
    install_processes(monkeypatch, [orphan])
    monkeypatch.setattr(launcher, "listener_pids", lambda port: {orphan.pid})
    monkeypatch.setattr(launcher, "nexora_healthy", lambda port: True)
    assert launcher.inspect_listener(project, 8000, "backend")[0]["orphan_worker"]


def test_unknown_listener_and_other_app_are_rejected(project, monkeypatch):
    install_processes(monkeypatch, [Process(50, project, ["python.exe", "other_app.py"])])
    for owner in [None, 50]:
        monkeypatch.setattr(launcher, "listener_pids", lambda port: {owner})
        with pytest.raises(launcher.LauncherError): launcher.inspect_listener(project, 8000, "backend")


def test_all_ports_are_inspected_without_stopping_anything(project, monkeypatch):
    calls = []
    def inspect(project, port, kind):
        calls.append(port)
        if port == 5173: raise launcher.LauncherError("Another app")
        return [{"pid": 42}]
    monkeypatch.setattr(launcher, "inspect_listener", inspect)
    monkeypatch.setattr(launcher, "stop_owned", lambda *args: pytest.fail("No mutation during preflight"))
    with pytest.raises(launcher.LauncherError): launcher.inspect_servers(project)
    assert calls == [8000, 5173]


def test_pid_reuse_and_changed_listener_never_terminate(project, monkeypatch):
    process = backend(project)
    install_processes(monkeypatch, [process])
    target = {**launcher.record(process, "backend", 8000), "created": 99}
    with pytest.raises(launcher.LauncherError): launcher.stop_owned(project, target)
    target["created"] = process.create_time()
    monkeypatch.setattr(launcher, "inspect_listener", lambda *args: [{"pid": 99, "created": 100.25}])
    with pytest.raises(launcher.LauncherError): launcher.stop_owned(project, target)
    assert not process.stopped


def test_cleanup_stops_only_matching_tree_and_keeps_other_children(project, monkeypatch):
    process = backend(project)
    child = worker(project, parent=process)
    unrelated = Process(45, project, ["python.exe", "unrelated_job.py"], parent=process)
    process._children = [child, unrelated]
    install_processes(monkeypatch, [process, child, unrelated])
    monkeypatch.setattr(launcher.psutil, "wait_procs", lambda processes, timeout: (processes, []))
    launcher.stop_owned(project, launcher.record(process, "backend"))
    assert process.stopped and child.stopped
    assert not unrelated.stopped


def test_listener_filter_only_reports_tcp_listeners_on_requested_port(monkeypatch):
    connections = [SimpleNamespace(pid=42, status=psutil.CONN_LISTEN, laddr=SimpleNamespace(port=8000)),
                   SimpleNamespace(pid=45, status=psutil.CONN_LISTEN, laddr=SimpleNamespace(port=5173)),
                   SimpleNamespace(pid=46, status=psutil.CONN_ESTABLISHED, laddr=SimpleNamespace(port=8000))]
    monkeypatch.setattr(launcher.psutil, "net_connections", lambda kind: connections)
    assert launcher.listener_pids(8000) == {42}
