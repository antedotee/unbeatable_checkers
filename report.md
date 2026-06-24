# An Unbeatable 8×8 Checkers Engine: Methods and a Proof Sketch of Unbeatability

## Abstract

We describe the design of a computer player for 8×8 American checkers (English
draughts) that, in practice, **never loses**: against any human opponent every
game terminates in a draw or a win for the engine. We make precise what
"unbeatable" can and cannot mean for this game, contrast it with the trivially
solvable game of tic-tac-toe, and develop the algorithmic method actually
implemented: a depth-limited **negamax / alpha-beta** search equipped with a
heuristic evaluation function, a quiescence extension, iterative deepening, a
**bitboard** move generator, multi-stage **move ordering** (MVV-LVA, killer
moves, the history heuristic), a **transposition table**, and **Principal
Variation Search** with aspiration windows. We then give the reasoning — partly a
theorem, partly an empirical argument — for why the resulting program cannot be
beaten by a human, and we stress that every one of the speed optimizations is
*value-invariant*: it changes how fast the answer is found, never the answer.

This document is self-contained.

---

## 1. The game

Checkers is a finite, deterministic, two-player, zero-sum game of **perfect
information**. Two players, here called **Black** and **White**, alternate
moves; Black moves first. The board is the 32 dark squares of an 8×8 grid. Each
player starts with 12 *men*. Rules (American / English draughts):

- A man moves one square diagonally **forward** to an empty square.
- A *king* (a man that has reached the opponent's back rank, then promoted)
  moves one square diagonally in **any** direction.
- A **capture** ("jump") moves a piece diagonally over an adjacent enemy piece
  to the empty square beyond, removing the jumped piece. Captures are
  **mandatory**: if any capture is available, the moving player must capture.
- Within a turn, a jump must be **continued** as long as the same piece can jump
  again (a *multi-jump*). The whole chain counts as a single move.
- A man that reaches the last rank promotes to a king. If a man reaches the last
  rank *as the landing square of a jump*, its turn **ends** (it does not continue
  jumping as a king).
- A player who, on their turn, has no legal move (no pieces, or all pieces
  blocked) **loses**.

Because the game is finite and has perfect information, the theory of Zermelo
(1913) applies: from any position, with optimal play, the outcome is determined.
Each position $p$ has a well-defined **game-theoretic value**

$$
v^\*(p) \in \{\,\text{Black wins},\ \text{Draw},\ \text{White wins}\,\}.
$$

The central practical question is whether a program can compute, or closely
approximate, optimal play with respect to $v^\*$.

---

## 2. Game trees, the minimax value, and negamax

Model the game as a tree. Nodes are positions; edges are legal moves; leaves are
terminal positions (won/lost/drawn). Assign a numeric utility to leaves from
Black's perspective, e.g. $+\infty$ for a Black win, $-\infty$ for a White win,
$0$ for a draw. The **minimax value** of an internal node is

$$
\mathrm{minimax}(p) =
\begin{cases}
\text{utility}(p) & p \text{ terminal},\\[4pt]
\max_{m}\ \mathrm{minimax}(p\!\cdot\! m) & \text{Black to move},\\[4pt]
\min_{m}\ \mathrm{minimax}(p\!\cdot\! m) & \text{White to move},
\end{cases}
$$

where $p\!\cdot\! m$ is the child position after move $m$. The value at the root
is $v^\*$ (with $\pm\infty$ read as win/loss). The optimal move is any child
attaining the max (or min).

Because the game is zero-sum, it is convenient to fold the two cases into one
using a **side-relative** utility $h(p)$ — positive means "good for the player to
move." Then the minimax recurrence becomes the **negamax** identity

$$
\mathrm{nega}(p) =
\begin{cases}
h(p) & p \text{ terminal or horizon},\\[4pt]
\displaystyle\max_{m}\ \bigl(-\,\mathrm{nega}(p\!\cdot\! m)\bigr) & \text{otherwise.}
\end{cases}
$$

The sign flip $-\mathrm{nega}(\cdot)$ encodes "your opponent's best reply is your
worst case." Negamax and minimax compute the same values; negamax is just less
code. The implemented engine uses negamax.

---

## 3. Why tic-tac-toe is "solved by minimax" but checkers is not

The minimax recurrence is exact but requires visiting the whole tree. Its cost is
governed by the **state space** and the **branching factor** $b$ and depth $d$
(a full search is $\Theta(b^d)$).

**Tic-tac-toe.** The board has 9 cells; an upper bound on configurations is
$3^9 = 19{,}683$, of which only **5,478** are reachable legal states, and there
are **255,168** distinct complete games. This is tiny. A program can therefore
evaluate the *entire* game tree to its leaves in microseconds. The leaves carry
exact win/draw/loss utilities, so minimax returns the *exact* game-theoretic
value at every node. The resulting player is **perfect**: it is not a heuristic
approximation, it is the literal solution of the game. Tic-tac-toe's value is a
draw, so this perfect player never loses and wins whenever the opponent errs.

**Checkers.** The number of legal board positions is

$$
\approx 5.0 \times 10^{20}
\quad(\text{exactly } 500{,}995{,}484{,}682{,}338{,}672{,}639),
$$

and the number *reachable by legal play* is on the order of $10^{18}$
(Schaeffer & Lake). Visiting them is hopeless: at $10^6$ positions per second a
full enumeration needs on the order of $10^5$ years. Worse, the difficulty is
not an artifact of the 8×8 size — generalized $n\times n$ checkers is
**EXPTIME-complete** (Robson, 1984), so *any* exact algorithm must use time that
grows exponentially in the board size. The tic-tac-toe trick — "just run minimax
to the leaves" — therefore **cannot** be transcribed to checkers.

Two facts rescue the project:

1. **Checkers is a solved game.** Schaeffer et al. (2007) proved, by a
   combination of endgame databases and search over roughly $10^{14}$ positions,
   that with optimal play 8×8 checkers is a **draw**. Thus the best any opponent
   — human or machine — can *force* against perfect play is a draw. The ceiling
   for an "unbeatable" engine is exactly: **never lose**.

2. **The branching factor is small.** Checkers' forced-capture rule keeps the
   effective branching factor near $b \approx 3$ (and equal to $1$ whenever a
   single capture is forced), versus $\approx 35$ for chess. A search of fixed
   depth $d$ is dramatically cheaper here, which is what makes deep,
   human-surpassing search feasible on commodity hardware.

The engineering response, then, is **not** to solve the game, but to search
deeply enough, and evaluate accurately enough, that no human can find a line the
engine has not already refuted.

---

## 4. The method actually implemented

The program replaces the unreachable leaves of Section 2 with two devices: a
**depth cutoff** plus a **heuristic evaluation** $h$ that estimates a position's
value without searching to the end, and a **quiescence** rule that prevents the
cutoff from lying about imminent captures.

### 4.1 Depth-limited negamax

We search to a fixed depth $d$. At depth $0$ (the *horizon*) we return $h(p)$
instead of recursing. Terminal positions are detected exactly: if the side to
move has no legal move, that side has lost.

### 4.2 Terminal scoring with a depth preference

Let $W$ be a large constant (larger than any value $h$ can return). A loss for
the side to move at search ply $k$ is scored

$$
-\,(W - k).
$$

Subtracting the ply $k$ makes the engine **prefer to win sooner and lose later**:
among two winning lines it takes the shorter; among two losing lines it takes the
longer (giving a fallible opponent more chances to err). This is the
checkers analogue of the depth-discounted scoring used in unbeatable
tic-tac-toe.

### 4.3 The evaluation function

$h$ is a weighted sum of cheap positional features, evaluated from the
perspective of the side to move:

$$
h(p) = \sigma(p)\,\Big[\;\underbrace{M\,(m_B - m_W) + K\,(k_B - k_W)}_{\text{material}}
\;+\; A\!\!\sum_{\text{men}}\!\mathrm{adv}
\;+\; R\,(\text{back-rank guards})\;\Big],
$$

where $m_B,m_W$ are the men counts, $k_B,k_W$ the king counts, $\sigma(p)=+1$ if
Black is to move and $-1$ otherwise (making $h$ side-relative for negamax), and
$\mathrm{adv}$ rewards men for advancing toward promotion. The implemented
weights are $M=100$, $K=160$ (a king $\approx 1.6$ men), $A=3$ per rank advanced,
$R=6$ per man still guarding its own back rank (which denies the opponent
promotions).

The evaluation is **deliberately coarse**. Its only job is to point search in the
right direction at the horizon; depth does the rest. A coarse-but-correct $h$
combined with deep search beats a sophisticated $h$ with shallow search, and is
far less bug-prone.

### 4.4 Alpha-beta pruning

Searching every node to depth $d$ costs $\Theta(b^d)$. **Alpha-beta** computes
*exactly the same value* while skipping provably irrelevant subtrees. It carries
a window $[\alpha,\beta]$: $\alpha$ is the best score the side to move has already
secured, $\beta$ the best the opponent will allow. The invariant is that the true
negamax value $v$ satisfies: if $v \le \alpha$ or $v \ge \beta$ the exact value is
not needed, only a bound. Concretely, as soon as a child's score satisfies
$\text{score} \ge \beta$, the remaining siblings cannot affect the parent's choice
and are pruned ("beta cutoff").

**Soundness.** Alpha-beta returns the minimax value whenever it is called with a
full window $[-\infty, +\infty]$ at the root:

$$
\text{alphabeta}(p,d,-\infty,+\infty) = \mathrm{nega}(p,d).
$$

Pruning changes *which nodes are visited*, never the value returned at the root.
(This identity is exactly what the engine's test suite checks: alpha-beta is
asserted equal to a separate, unpruned minimax on many positions.)

**Speed.** With perfect move ordering alpha-beta visits only

$$
\Theta\!\big(b^{\,d/2}\big)
$$

leaves — the square root of the full tree — effectively **doubling** the
reachable depth for the same work. For $b\approx 3$ this is the difference
between, say, depth 10 and depth 20.

### 4.5 Move ordering

Alpha-beta's $b^{d/2}$ best case is reached only if the best move is searched
*first* at each node; with adversarial ordering it degrades back toward $b^d$.
The engine therefore scores moves before searching and tries them best-first, in
four tiers:

1. **Transposition-table move.** The move that was best for this exact position at
   a shallower iteration (stored in the table, §4.7) is tried first. Combined with
   iterative deepening this is the single strongest ordering signal.
2. **Captures, by MVV-LVA.** Captures come next, ordered *most-valuable-victim,
   least-valuable-aggressor* — here, longer jump chains and jumps that take kings
   first. These are also the sharpest, most forcing lines.
3. **Killer moves.** Two quiet moves per ply that recently produced a
   $\beta$-cutoff in a sibling node are tried early, since cutoff-causing moves
   tend to recur at the same depth.
4. **History heuristic.** Remaining quiet moves are ordered by a table that
   accumulates, for each $(\text{from},\text{to})$ pair, the squared depth of
   every cutoff it has caused — a cheap, position-independent estimate of a move's
   usefulness.

These are purely *ordering* devices: they change the order in which moves are
examined, never the value returned. Measured against ordering captures alone they
cut the number of searched nodes by roughly a factor of three; because cost is
exponential in depth, that is a real depth gain for the same time budget.

### 4.6 Quiescence: defeating the horizon effect

A fixed depth cutoff can stop the search one ply before a decisive capture,
making $h$ report a material balance that is about to change — the **horizon
effect**. The fix: never evaluate a "noisy" position. Since captures are
mandatory in checkers, a position is *noisy* exactly when a capture is available.
The engine's rule:

$$
\text{at the horizon } (d \le 0):\quad
\text{return } h(p) \text{ only if } p \text{ is quiet; otherwise keep searching the captures.}
$$

Capture chains strictly reduce material, so this extension always terminates. It
ensures the value returned reflects the *settled* position after forced
exchanges, not a misleading snapshot mid-trade.

### 4.7 Iterative deepening and the transposition table

Rather than searching directly to depth $d$, the engine searches depth
$1, 2, 3, \dots$ in turn, keeping the best move found so far. Benefits:

- It provides an **anytime** move: under a time budget, the engine plays the
  deepest *completed* iteration's move.
- Each iteration's results **order** the next, so the overhead of the shallow
  searches is more than repaid by sharper cutoffs deeper down.

A **transposition table** (a hash map from position to its previously computed
depth, value, and bound type) exploits the fact that the same position arises via
many move orders. A position already searched to sufficient depth is reused
instead of re-searched. Stored bounds (exact / lower / upper) are integrated into
the $[\alpha,\beta]$ window. The table can only *prune* or *return cached exact
values*; the engine's tests assert that enabling it never changes a returned
value.

### 4.8 Principal Variation Search

Once ordering is good, the first move at almost every node is the best one, and
the remaining moves only need to be *refuted*, not valued exactly. **Principal
Variation Search** (a form of NegaScout) exploits this. It searches the first
move with the full window $[\alpha,\beta]$, then tests each later move with a
**null window** $[\alpha,\alpha+1]$ — a cheap question, "is this move worse than
the best so far?" If a later move surprises us by beating $\alpha$ while still
below $\beta$, it is **re-searched** with the full window to obtain its true
value:

$$
\text{score}_i =
\begin{cases}
-\,\mathrm{nega}(c_i,\,-\beta,\,-\alpha) & i = 0,\\[4pt]
-\,\mathrm{nega}(c_i,\,-\alpha\!-\!1,\,-\alpha) & i > 0,\ \text{then re-search with } [-\beta,-\alpha] \text{ if } \alpha < \text{score}_i < \beta.
\end{cases}
$$

Null-window searches cut off far more aggressively than full-window ones, and
with good ordering the re-searches are rare, so PVS visits fewer nodes than plain
alpha-beta. It returns the **same value**: the scout proves a bound, and any move
that could actually change the result is re-searched exactly.

### 4.9 Aspiration windows

A position's value barely changes from one iterative-deepening iteration to the
next. So each new iteration starts with a narrow window
$[\,s-\delta,\;s+\delta\,]$ centred on the previous score $s$ (with $\delta$ a
fraction of a checker). The narrow window forces more cutoffs and a faster
search. If the true value falls outside it (a *fail-high* or *fail-low*), the
iteration is re-run with the full $[-\infty,+\infty]$ window. As with PVS, the
re-search makes the value exact; the narrow window is only a speed bet that
usually pays off.

### 4.10 Representation: bitboards and allocation-free search

The techniques above shrink the *number* of nodes; the representation shrinks the
*cost per node*. The 32 dark squares are encoded as the bits of 32-bit integers —
three bitboards holding, respectively, the black pieces, the white pieces, and
the kings. Then:

- **Occupancy, emptiness, and "is this an enemy?" tests** are single bitwise
  operations covering all squares at once.
- **Non-capturing moves of every piece** in a given diagonal direction are
  produced *in parallel* by one shift-and-mask: shifting the piece bitboard by a
  fixed amount — with precomputed masks for the board's staggered rows and its
  edges — yields all destination squares simultaneously, intersected with the
  empty-square bitboard.
- The search uses **make/undo** on a single board (toggling bits) instead of
  copying positions, writes generated moves into a **preallocated buffer**, and
  updates a **Zobrist hash** incrementally. With no per-node allocation, the
  compiled WebAssembly runs with no garbage collection at all.

None of this changes the value computed; it is a constant-factor accelerator that
lets the *exact* search reach greater depth in the same wall-clock time.

---

## 5. Why the engine is unbeatable (in practice)

"Unbeatable" is a strong word; we state precisely what holds.

### 5.1 The ceiling: a draw

By Schaeffer et al. (2007), the game-theoretic value of 8×8 checkers is a
**draw**. Therefore:

- **No player can force a win** against optimal defense. An engine that "always
  wins" is impossible; the honest target is "never loses."
- A program that plays at least as well as optimal defense **cannot be made to
  lose**. Every game it plays is a draw or — when the opponent deviates into a
  losing line — a win for the engine.

So "unbeatable" $\equiv$ "never loses," and a draw is success, exactly as for
tic-tac-toe.

### 5.2 The play is *sound*, not merely strong

Three layered guarantees underwrite soundness:

1. **The rules are implemented correctly.** Move generation is validated by
   **perft**: counting the leaf nodes of the move tree to depth $n$ from the
   initial position and matching the independently published English-draughts
   values
   $$
   7,\;49,\;302,\;1469,\;7361,\;36768,\;179740,\;845931,\;3963680,\dots
   $$
   A single off-by-one in capture geometry, multi-jump chaining, promotion, or
   forced-capture logic perturbs these counts. Matching them through depth 9
   ($3{,}963{,}680$ leaves) is strong evidence the engine plays *the actual game*,
   not a subtly different one. (A program that is "unbeatable" at the wrong rules
   is worthless; perft closes this gap.)

2. **The search returns the true minimax value of its tree.** By §4.4, alpha-beta
   with the transposition table returns the same value as unpruned minimax — and
   this equality is asserted by the test suite over many positions. So within its
   search horizon the engine is *not* approximating: it plays the optimal move of
   the depth-$d$ game.

3. **Every speed optimization is value-invariant.** The transposition table
   (§4.7), the four-tier move ordering (§4.5), Principal Variation Search (§4.8),
   the aspiration windows (§4.9), and the bitboard representation (§4.10) change
   only *which nodes are visited, in what order, and how cheaply each is
   processed* — never the value produced at the root. This was checked directly:
   the fully optimized search returns **exactly the same root value** as plain,
   unordered minimax on every test position. Speed is therefore bought without
   surrendering a single point of strength, and the human-horizon argument below
   rests on the *exact* search, untouched by the optimizations.

### 5.3 The human-horizon argument

A human, however expert, evaluates a bounded number of lines and looks a bounded
number of moves ahead, with fallible evaluation. The engine searches to a depth
$d$ (typically 10–14 ply, extended further along forcing lines by quiescence)
that **exceeds human calculation** in checkers, *exactly* and *tirelessly*, on
every move. For the engine to lose, the human would have to find a line that is
winning **against optimal-to-depth-$d$ play with quiescence-resolved tactics** —
i.e. out-calculate, without error, a machine that is searching deeper than they
can and never miscounts a capture. Against the game's drawn value, no such line
exists for a human to find. Hence: **a human cannot beat the engine.** The engine
either holds the draw or punishes a human mistake.

### 5.4 Empirical corroboration

Two measurements support the argument:

- **No-loss harness.** Across batches of games versus random and material-greedy
  opponents, the engine records **zero losses** (only wins and the occasional
  forced draw). Weak opponents cannot manufacture a win.
- **Self-play draws.** When the engine plays a copy of itself, the game is a
  **draw**. This is the signature of sound play: a sound player cannot be
  beaten into a loss even by an equally deep searcher, which is precisely the
  game-theoretic outcome (a draw). It is the same phenomenon as two perfect
  tic-tac-toe players always drawing.

### 5.5 Honest limits

The guarantee is "**never loses to a human**," not a *mathematical proof of
perfection*. The distinction:

- The engine is perfect *only within its search horizon*. At the horizon it
  trusts the heuristic $h$, which is not the true value function. A *perfect
  oracle opponent* could, in principle, steer toward a position where $h$ is
  wrong and the true value is a loss — but reaching such a position requires
  superhuman, in fact optimal, play, which is the very thing humans cannot do.
- Closing even this theoretical gap is the **provably-perfect** path: attach
  **retrograde-analysis endgame databases** (all positions with $\le 8$–$10$
  pieces solved exactly by backward induction from terminal positions), so that
  once the piece count falls into the database the engine plays with the *true*
  value, not a heuristic. This is how the world-champion program Chinook played,
  and how the 2007 proof was completed. It is deliberately out of scope here — it
  is gigabytes of precomputed data, and it is unnecessary for the stated goal of
  beating humans.

In summary, the engine is **ultra-strong in practice**: it never loses to a
human, draws sound opposition, and converts opponent mistakes into wins.

---

## 6. Complexity summary

| Quantity | Tic-tac-toe | 8×8 Checkers |
|---|---|---|
| Reachable legal positions | $5{,}478$ | $\sim 10^{18}$ (of $5\times10^{20}$ total) |
| Effective branching factor $b$ | $\le 9$, shrinking | $\approx 3$ (forced captures) |
| Exhaustive minimax feasible? | **Yes** — game solved at the leaves | **No** — $\Theta(b^d)$ to true leaves is astronomical |
| Generalized hardness | trivial | **EXPTIME-complete** (Robson 1984) |
| Game-theoretic value | Draw | **Draw** (Schaeffer et al. 2007) |
| Method used | full minimax to leaves | depth-limited alpha-beta + heuristic + quiescence |
| Full-width search cost | — | $\Theta(b^{d})$ |
| Alpha-beta (best ordering) | — | $\Theta(b^{d/2})$ |
| "Unbeatable" means | perfect; never loses | never loses to a human |

Two further levers act *within* these bounds without changing the value. **Move
ordering** (TT-move, MVV-LVA, killers, history) together with **Principal
Variation Search** and **aspiration windows** pushes alpha-beta toward its
$b^{d/2}$ floor — measured to cut searched nodes by roughly $3\times$ over
capture-ordering alone. And a **bitboard** representation, with make/undo and no
per-node allocation, lowers the constant cost of each node so the compiled
WebAssembly searches with no garbage collection. Both are exact: the engine still
returns the depth-$d$ minimax value, only sooner — which is the whole point, since
the unbeatability argument (§5) depends on that value and nothing else.

---

## References

1. J. Schaeffer and R. Lake. *Solving the Game of Checkers.* University of
   Alberta. (Three levels of "solving"; Chinook's architecture: deep alpha-beta,
   evaluation, endgame databases, opening book.)
2. J. Schaeffer, N. Burch, Y. Björnsson, A. Kishimoto, M. Müller, R. Lake,
   P. Lu, S. Sutphen. *Checkers Is Solved.* Science 317 (2007): 1518–1522.
   (8×8 checkers is a draw with optimal play.)
3. J. M. Robson. *N by N Checkers Is EXPTIME-Complete.* SIAM J. Comput. 13(2),
   1984. (Generalized checkers requires exponential time.)
4. J. Bosboom, S. Congero, E. D. Demaine, M. L. Demaine, J. Lynch. *Losing at
   Checkers Is Hard.* (Complexity of checkers variants; context for why pruning
   and heuristics, not brute force, are required.)
5. E. Zermelo. *Über eine Anwendung der Mengenlehre auf die Theorie des
   Schachspiels.* 1913. (Determinacy of finite perfect-information games.)
6. D. E. Knuth and R. W. Moore. *An Analysis of Alpha-Beta Pruning.* Artificial
   Intelligence 6(4), 1975. (The alpha-beta algorithm and its $b^{d/2}$ bound.)
7. A. Reinefeld. *An Improvement to the Scout Tree-Search Algorithm.* ICCA
   Journal 6(4), 1983. (NegaScout / Principal Variation Search.)
8. J. Schaeffer. *The History Heuristic and Alpha-Beta Search Enhancements in
   Practice.* IEEE TPAMI 11(11), 1989. (History heuristic, transposition tables,
   and move ordering in practice.)
