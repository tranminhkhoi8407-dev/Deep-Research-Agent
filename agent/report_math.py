"""Shared bounded math allowlist for report generation and export."""
import re

MATH_COMMANDS = set("frac dfrac tfrac sqrt left right mathbb mathcal mathbf mathrm mathit mathsf boldsymbol operatorname text textrm textbf overline underline hat widehat tilde widetilde vec dot ddot overset underset substack stackrel sum prod int iint iiint oint lim log ln exp min max arg det sin cos tan sinh cosh tanh underbrace overbrace binom dbinom ldots cdots vdots ddots dots quad qquad begin end hline lVert rVert vert Vert langle rangle lceil rceil lfloor rfloor le leq ge geq neq ne ll gg approx sim simeq equiv propto in notin subset subseteq supset supseteq cup cap emptyset varnothing forall exists neg land lor to rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow mapsto times cdot div pm mp partial nabla infty ell Re Im mid perp top bot angle alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega geqslant leqslant displaystyle textstyle scriptscriptstyle limits nolimits tag nonumber notag big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr coloneqq triangleq".split())
MATH_ENVS = {"aligned", "split", "cases", "matrix", "pmatrix", "bmatrix", "vmatrix", "Bmatrix", "Vmatrix", "array"}


def safe_math(raw):
    if len(raw) > 12000 or raw.count("{") != raw.count("}") or raw.count("{") > 200 or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", raw):
        return None
    if any(command not in MATH_COMMANDS for command in re.findall(r"\\([A-Za-z]+)", raw)):
        return None
    if any(env not in MATH_ENVS for env in re.findall(r"\\(?:begin|end)\{([^}]+)\}", raw)):
        return None
    if re.search(r"(?<!\\)[%#]", raw) or "^^" in raw or "\x00" in raw:
        return None
    depth = 0
    for match in re.finditer(r"\\.|[{}]", raw):
        char = match.group()
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                return None
    environments = []
    for action, env in re.findall(r"\\(begin|end)\{([^}]+)\}", raw):
        if action == "begin":
            environments.append(env)
        elif not environments or environments.pop() != env:
            return None
    if depth or environments:
        return None
    return raw
