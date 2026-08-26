Technical Design Specification: Visual Kanban Orchestrator for Claude Code Agents

1. Problem Statement: The Cognitive Cost of Parallel Orchestration

As software development moves from single-threaded workflows to multi-agent parallel execution, developers face a critical bottleneck: context fragmentation. Traditional project management tools like Jira or Trello are architecturally decoupled from the local developer runtime, requiring manual state updates that introduce administrative overhead—overhead that active developers routinely reject. When a developer operates four distinct terminals in a screen grid, they rely on continuous visual polling to track status. This manual monitoring is not scalable and leads to "idle execution states" where agents sit stalled, waiting for input that the developer hasn't noticed.

The cognitive friction of monitoring n active agents can be modeled as:

$C_m = \sum_{i=1}^{n} (S_i \times T_i) + \delta \cdot P_c$

In this model, S_i represents the semantic complexity of the task, while T_i tracks the time elapsed since the last inspection. The variable \delta represents the specific penalty for manual window switching, and P_c is the probability of an agent stalling for permission. As n increases, T_i grows proportionally, drastically increasing the likelihood of "Forgotten Agent Syndrome." A centralized dashboard is an architectural necessity to transform hidden terminal sessions into high-visibility state observations, reducing P_c and maximizing developer velocity. This strategic shift from manual window management to automated observation necessitates a deep dive into the underlying data structures of the Claude Code runtime.

2. Data Extraction and Synchronization Logic

To maintain high-fidelity state without the bloat of external databases, the orchestrator must treat the local filesystem as the ground truth. Parsing local JSONL files and utilizing native CLI commands is superior for single-user DevEx because it avoids synchronization lag and keeps the tool lightweight.

Session Transcript Parsing

Claude Code manages metadata within the .claude directory using an append-only JSON Lines (.jsonl) schema. This design ensures that data is saved immediately to disk, protecting session state even during terminal crashes. The monitoring engine must parse these trace files to extract real-time execution steps, tool arguments, and the exact UUID of paused sessions.

Programmatic CLI Hooking

The orchestrator controls the fleet through a prescriptive "Command Interface Dictionary."

Command    Mapping to UI Action
claude agents --json --all    Refresh Kanban board with active and completed sessions.
Parse ~/.claude/projects/<project>/<session-id>.jsonl    Open real-time console output for a specific card (there is no `claude logs` subcommand; transcripts are read directly from disk).
claude attach <session_id>    Pull a background session into the foreground terminal.
Stop via the interactive `claude agents` view (or terminate the session process)    Safely pause and detach a running execution thread (there is no `claude stop` / `kill` CLI subcommand).
Re-dispatch halted sessions from the `claude agents` view    Restart halted agents from their last recorded checkpoints (there is no `claude respawn` subcommand).

Avoiding Redirection Redundancy

A common pitfall in Windows environments is "Redirection Redundancy," where PowerShell pipelines interfere with binary standard I/O streams. This often results in blocked buffers or child processes hanging indefinitely. As a Lead Architect, I prescribe invoking the CLI daemon using native system executables or direct standard output file dumps. This forces synchronous I/O operations to write straight to disk, bypassing the unreliable PowerShell pipeline. While raw CLI data provides the baseline state, achieving true reactivity requires leveraging the deterministic event-driven architecture of lifecycle hooks.

3. Event-Driven Architecture via Lifecycle Hooks

Claude Code’s hook framework provides deterministic control, transforming the dashboard from a static viewer into a reactive control center. Hooks ensure that the dashboard is proactive—calling the developer’s attention to agents—rather than the developer having to reactively poll terminals.

Dynamic Event Triggers

The orchestrator utilizes four primary lifecycle events to drive the board:

* SessionStart: Spawns a new card on the board.
* PreToolUse: Updates the card’s active log with the specific command (e.g., Bash, Edit).
* Notification: Triggers an "Amber Alert" status when an agent requires input.
* SessionEnd: Archives the card or moves it to the "Done" column.

Hook Configuration Injection

To register these events, the following structure must be injected into ~/.claude/settings.json:

{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:8080/hooks/notification"
          }
        ]
      }
    ]
  }
}

Note: HTTP hooks automatically issue a POST request carrying the event payload as JSON — no separate `"command": "POST"` field is used (that field belongs to shell-command-type hooks). Matcher patterns primarily apply to tool-related events; verify the current matcher semantics for `Notification` against the Hooks reference before relying on reason-string filtering such as `permission_prompt|idle_prompt`.

This configuration eliminates the need for visual terminal polling. When an agent hits a permission prompt, the dashboard receives a push notification immediately, effectively solving "Forgotten Agent Syndrome." By transforming these event streams into visual signals, we can map the abstract state of a fleet of agents onto the proven ergonomics of a Kanban interface.

4. Visual Framework: The Shadcn/UI Kanban Interface

For the front-end, we adopt the 2026-grade Shadcn/UI standard. Choosing an "accessibility-first" and "zero-dependency" template is an architectural standard to ensure long-term maintainability and performance.

Template Selection Matrix

The following table compares the top Shadcn-compatible sources for the orchestrator:

Template Source    Strategic Value    DevEx Polish
janhesters/shadcn-kanban-board    Zero-dependency, Accessibility-first.    Smallest bundle size; full keyboard navigation.
Georgegriff    Based on @dnd-kit.    Modern drag-and-drop primitives.
shadcn-kanban-board (Vercel)    Full B2B/B2C SaaS template.    High visual polish; ready for production deployment.

Precise State Mapping

The Kanban columns must reflect the internal state of the Claude Code agents with mathematical precision:

* To Do: Agents in an Idle state.
* In Progress: Active agents in a Working state.
* In Review: Agents requiring attention (Amber Alert), triggered by Needs Input.
* Done: Sessions that have reached SessionEnd or Completed.

A "Single-board" structure is the standard for tracking agents within a single repository, while a "Multi-board" workspace pattern (similar to Trello or Linear) is recommended for managing context isolation across disparate projects or feature branches. Selecting the correct visual template is only the first step; the architecture must be realized through a robust implementation stack tailored to the developer’s specific interactivity requirements.

5. Implementation Blueprints: Python and Node.js Stacks

The choice of stack determines whether the dashboard is a passive observer or an active participant in the dev environment.

Option 1: Streamlit (Python Read-Only Observer)

This stack is ideal for rapid prototyping and read-only monitoring. It uses Streamlit for the UI, FastAPI for the hook endpoint, and background threading for CLI polling. While efficient for state tracking, it lacks the deep interactivity required for terminal-heavy workflows.

Option 2: React/Node.js (Interactive Terminal IDE)

For high-performance needs, this stack is the architectural gold standard. It utilizes xterm.js for browser-based terminals and node-pty for system-level pseudo-terminal binding.

* 16ms Batching Logic: High-performance DevEx requires batching terminal output at 16ms intervals (aligning with the 60fps refresh rate). Burst-heavy PTY output from AI agents can saturate the IPC bridge, leading to "UI freezing." Batching ensures the UI remains responsive even during high-velocity code generation.
* Inline Attachment: Unlike the Python stack, Node.js allows for "inline attachment," where developers interact with sessions directly in the browser, drastically reducing window-switching friction (\delta).

Regardless of the chosen stack, developers operating in Windows environments must navigate specific native compilation hurdles to ensure PTY stability.

6. Technical Audit and Windows Integration

Building the node-pty native binary on Windows represents a significant integration challenge due to the complexities of the Windows Native PTY compilation pipeline.

ConPTY and Native Compilation

The orchestrator relies on the Microsoft ConPTY API (available on Windows 10 build 18309+). To verify dependencies and install the compilation tools, the developer must run commands in an elevated PowerShell terminal.

* Mandatory Workloads: Visual Studio 2022 must include the "C++ Desktop Development" workload and the correct Spectre-mitigated libraries to avoid build errors.

Terminal Automation Blueprints

For power users, layout automation allows for instant context switching:

* Strategy A: WezTerm Lua Workspaces: This is the superior choice for power users. WezTerm serves as a "dynamic configuration engine," using Lua to manage named workspaces and complex panel groupings programmatically.
* Strategy B: Windows Terminal (wt.exe) Splits: Layouts can be automated via command-line arguments. A standard 2x2 grid is generated via: wt -p "PowerShell" ; split-pane -p "PowerShell" -H ; move-focus left ; split-pane -p "PowerShell" -V ; move-focus right ; split-pane -p "PowerShell" -V

Architectural Advantages

This design transforms the "mental list" of agents into a single, high-visibility state observation platform. By leveraging local system APIs and custom script configurations, developers achieve lowered cognitive overhead, direct programmatic control through UI-driven actions (stop, respawn, logs), and zero license costs. This orchestrator allows developers to scale concurrent AI workflows while maintaining absolute oversight of the autonomous coding process.
