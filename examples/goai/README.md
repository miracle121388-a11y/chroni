# GOAI reproducible demo inputs

These synthetic fixtures mirror the three in-app GOAI demo paths. They contain no personal data and require no API key.

| Scenario | Input | Expected behavior |
| --- | --- | --- |
| A | `A-clear-database-assignment.txt` | Create one task, retain two deliverables, generate a task plan, and show an Agent trace. |
| B | `B-ambiguous-startup-materials.txt` | Retain title and deliverables, then ask only for the missing concrete due time. |
| C | `C-conflicting-deadlines.txt` | Preserve both deadline claims and wait for the user to select a trusted source. |
| Output evidence | `synthetic-output-evidence.txt` | Register a clearly labeled synthetic file in Learning Mission to demonstrate local SHA-256 and deliverable linkage. It is not coursework or a solution. |

Use the **GOAI Demo** tab for the deterministic no-key path. Dragging these files into the regular intake path exercises the configured parser and, when enabled, the configured LLM.
