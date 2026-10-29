---
name: tkxel-vault-memory-advisor
description: >-
  Maintain and synchronize tkxel Vault's living project memory (PROJECT_MEMORY.md), perform continuous
  agent capability audits, detect domain gaps in ongoing initiatives, and automatically propose/scaffold
  new specialized agents. Use whenever project milestones shift, new domains emerge, or tasks lack owner agents.
---

# tkxel Vault: Project Memory & Dynamic Agent Advisor Skill

This skill governs the continuous maintenance of [PROJECT_MEMORY.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/PROJECT_MEMORY.md) and provides the protocol for automatically identifying and proposing new specialized agents as the tkxel Vault codebase evolves.

## Core Responsibilities

1. **Project Memory Synchronization**:
   - Update `PROJECT_MEMORY.md` whenever:
     - A major milestone or technical epic completes.
     - A new architectural decision or technology dependency is introduced.
     - An architectural invariant or system boundary changes.
     - A new specialized agent is chartered.

2. **Automated Capability Gap Detection**:
   - When reviewing incoming feature requests, architectural issues, or user prompts, check against the active agent capability matrix in `PROJECT_MEMORY.md`.
   - Run the automated analyzer:
     ```powershell
     python .agents/scripts/check_agent_coverage.py --query "Deploy to Kubernetes with Terraform and configure Prometheus metrics"
     ```
   - If a request heavily relies on an uncovered domain, alert the user and formulate an agent recommendation.

3. **Agent Proposal & Scaffolding Template**:
   When proposing a new agent, format the output as follows:
   ```markdown
   ### 💡 Recommended New Agent: [Agent Title]
   - **Reason for Suggestion:** [Identified capability gap or upcoming milestone]
   - **Target File:** `.agents/agents/[agent_identifier]_agent.md`
   - **Skill File:** `.agents/skills/tkxel-vault-[skill-name]/SKILL.md`
   - **Primary Responsibilities:** [Key technical tasks]
   - **Integration Touchpoints:** [How it collaborates with existing agents]
   ```

4. **Self-Updating Memory Ledger**:
   - Keep the milestone checklist and changelog up-to-date.
   - Maintain the architectural decisions table so any new agent immediately understands historical context and invariants.
