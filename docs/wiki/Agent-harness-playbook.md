# Agent harness for verifying DVR workflows

Use a small, repeatable acceptance task to improve how an assistant plans,
checks and hands off Intelligent DVR work. Start with a recording review or
facility workflow that can be exercised with existing local fixtures. The goal
is a faster route to supported conclusions about the actual browser and edge
behavior. [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Development](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Development-and-checks)

## Prepare a task an assistant can verify

- Give the assistant one visible user outcome, the affected workspace and
  implementation path, fixture and source revision, and the required checks.
  Start from the repository instructions and relevant product status. For
  recording review, state exactly how the recording becomes an observation
  and when an operator chooses **Send to Events**. [Repository guidance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/AGENTS.md) · [Recording workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow)
- Separate the browser workspace, local edge service, detector and hardware
  profile in the evidence. Let explicit commands and fixtures establish the
  active environment. Label source checks, synthetic browser checks and native
  field acceptance with the applicable inputs and limits.
  [Offline qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-qualification)
- Capture the job ID, fixture, selected workflow/inputs, expected transition,
  observed state and failed or unperformed check. On resume, read the current
  job and source state before acting. Keep stale responses associated with
  their own jobs. Use elapsed time, complete/partial counts and reason codes
  in progress records.
- Keep recorded media, personal information and camera access details out of
  shared agent context. Use synthetic or explicitly permitted material and
  existing operator approval points. Check media and event transitions with
  deterministic assertions. Have a second reviewer use the actual interface
  and receipt to confirm the result.

## First experiment

Use one synthetic local recording with an expected observation plus a matching
failure case, such as unavailable analysis or a canceled job. Write the user
acceptance criteria first. In arm A, give the usual project entry points. In
arm B, also give one compact task packet linking the controlling workspace
and fixture, including the expected analysis status and operator-visible
handoff. Use the same model, checkout, approved tools, browser fixture,
time limit and pass criteria.

Score the verified product outcome, exact check coverage, correct handling of
cancellation or incomplete results, elapsed time, human prompts and retries.
Check that results retain their review status and reach Events only through
the explicit operator action. The comparison passes only if the change
preserves baseline passes and reduces a predefined source-search or review cost
without changing the privacy or action boundary. Report skipped and failed
checks by surface.

For later model comparisons, fix workload, classes, threshold, sampling and
machine profile before varying the harness. Compare recording continuity,
analysis lag and dropped work alongside recognition quality. Treat one local
fixture as a development result and use the existing qualification and native
acceptance plans for deployment claims. [Tracking evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Tracking-evaluation) · [Live detection](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-AI-and-tracking)

## Reference patterns

- Add session continuity, runtime feedback and a separate browser verification pass. [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering)
- Use typed job states, retained errors and an explicit operator transition. [12-Factor Agents](https://github.com/humanlayer/12-factor-agents)
- Use the existing repository guidance and test entry points. [AGENTS.md](https://agents.md/)
- Write the browser journey and its acceptance outcomes before editing. [GitHub Spec Kit](https://github.com/github/spec-kit)
- Study persisted state and human checkpoints for long local jobs. [Deep Agents](https://github.com/langchain-ai/deepagents)
- Keep the fixture replay short enough to inspect. [Mini SWE Agent](https://github.com/SWE-agent/mini-swe-agent)
- Compare tool and context choices with primary project sources. [Awesome AI Anatomy](https://github.com/NeuZhou/awesome-ai-anatomy)
- Consider isolated task packaging if the browser acceptance corpus needs it. [Harbor](https://github.com/harbor-framework/harbor)

[Original SATNA Project discussion](https://www.reddit.com/r/SATNA_PROJECT/comments/1xyrkvz/your_ai_agent_might_not_need_a_better_model_it/)

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/agent-harness-playbook.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
