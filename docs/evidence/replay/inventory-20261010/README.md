# Measured Codex 0.160.0 tool surface (2026-10-10)

Captured with the exact runner flags against a local mock Responses endpoint (no credentials, clean CODEX_HOME). Turn 1 asks the
exec orchestrator to enumerate `ALL_TOOLS` (the runtime's own list of enabled nested tools, including deferred MCP tools); turn 2 carries
that output. `inventory-{A,B,C}.json` hold the static declarations and the runtime list. The raw requests contain OpenAI's own base
prompt, so they are NOT committed; only their SHA-256 values are (`RAW-REQUEST-SHA256.txt`). Raw copies are kept locally outside the repository.
Residual surface common to all arms: apply_patch, view_image, clock__curr_time, list_mcp_resources, list_mcp_resource_templates,
read_mcp_resource (+ top-level exec, wait, request_user_input(_async) and the collaboration/subagent tools). Arm tools: A 5, B +read_checklist, C +consult.
