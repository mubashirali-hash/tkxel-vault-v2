#!/usr/bin/env python3
"""
tkxel Vault - Agent Coverage & Gap Advisor
Analyzes tasks, prompts, or project backlogs against the active agent capability
registry and suggests newly needed specialized agents when capability gaps are found.
"""

import sys
import argparse
import json
import re
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
    except AttributeError:
        pass

# Registry of current agents and their covered keywords/domains
ACTIVE_AGENTS = {
    "orchestrator_planner_agent": {
        "title": "Lead Technical Orchestrator & Master Planner",
        "keywords": ["plan", "orchestrate", "milestone", "roadmap", "sequence", "breakdown", "dependencies", "architecture review"],
    },
    "docs_technical_writer_agent": {
        "title": "Principal Technical Writer & Scribe",
        "keywords": ["documentation", "adr", "architecture decision record", "docs", "readme", "user guide", "runbook", "data dictionary", "api reference"],
    },
    "backend_rag_agent": {
        "title": "Backend & Knowledge Graph / RAG Architect",
        "keywords": ["postgres", "postgresql", "pgvector", "sql", "gbrain", "hybrid search", "bm25", "vector", "embedding", "chunk", "get_context", "schema", "relations", "rrf"],
    },
    "frontend_graph_agent": {
        "title": "Frontend & Knowledge Graph Architect",
        "keywords": ["frontend", "ui", "ux", "react", "tiptap", "milkdown", "editor", "wysiwyg", "d3", "cytoscape", "graph", "webgl", "canvas", "css", "component"],
    },
    "mcp_gateway_agent": {
        "title": "Remote MCP Gateway Architect",
        "keywords": ["mcp", "model context protocol", "streamable http", "claude connector", "tools", "oauth 2.1", "pkce", "json-rpc", "remote gateway"],
    },
    "security_crypto_agent": {
        "title": "Security, Cryptography & IAM Architect",
        "keywords": ["security", "crypto", "encryption", "aes-256-gcm", "envelope encryption", "kms", "key vault", "oidc", "sso", "audit log", "revocation", "zero-trust"],
    },
    "runtime_sandbox_agent": {
        "title": "Runtime Sandboxing & Locked Skill Execution Engineer",
        "keywords": ["sandbox", "runtime", "container", "docker", "gvisor", "run_skill", "locked skill", "timeout", "ephemeral", "isolation", "resource limits"],
    },
    "qa_redteam_agent": {
        "title": "Red Team, Penetration Testing & QA Automation Lead",
        "keywords": ["qa", "test", "red team", "pentest", "penetration", "prompt injection", "jailbreak", "exfiltration", "security audit", "leakage", "regression"],
    }
}

# Heuristics for potential missing agent capabilities
POTENTIAL_AGENTS = {
    "cloud_sre_agent": {
        "title": "Cloud Infrastructure & SRE Lead",
        "keywords": ["terraform", "helm", "kubernetes", "k8s", "aws ecs", "eks", "observability", "grafana", "prometheus", "cloudwatch", "datadog", "ci/cd pipeline", "github actions", "deploy"],
        "reason": "Task involves cloud orchestration, container clusters, or production telemetry beyond basic local sandboxing.",
        "spec_file": ".agents/agents/cloud_sre_agent.md",
        "skill_dir": ".agents/skills/tkxel-vault-cloud-sre"
    },
    "compliance_governance_agent": {
        "title": "Compliance, Governance & Privacy Lead",
        "keywords": ["soc2", "hipaa", "iso27001", "gdpr", "data retention", "compliance report", "privacy policy", "data governance", "pii audit"],
        "reason": "Task requires formal regulatory compliance auditing, certification readiness, or legal privacy enforcement.",
        "spec_file": ".agents/agents/compliance_governance_agent.md",
        "skill_dir": ".agents/skills/tkxel-vault-compliance-governance"
    },
    "client_desktop_agent": {
        "title": "Desktop & Mobile Client Lead",
        "keywords": ["electron", "tauri", "react native", "desktop app", "local vault sync", "offline mode", "filesystem watcher", "macos app", "windows app"],
        "reason": "Task pertains to standalone desktop or mobile client applications with local filesystem synchronization.",
        "spec_file": ".agents/agents/client_desktop_agent.md",
        "skill_dir": ".agents/skills/tkxel-vault-client-desktop"
    },
    "etl_migration_agent": {
        "title": "Data Migration & Ingestion ETL Architect",
        "keywords": ["notion import", "confluence migration", "obsidian sync", "roam migration", "evernote", "bulk import", "data pipeline", "batch indexing", "etl"],
        "reason": "Task focuses on high-volume knowledge ingestion, format transformation, or external wiki migration.",
        "spec_file": ".agents/agents/etl_migration_agent.md",
        "skill_dir": ".agents/skills/tkxel-vault-etl-migration"
    },
    "analytics_billing_agent": {
        "title": "Analytics, Quota & Billing Telemetry Lead",
        "keywords": ["stripe", "billing", "metering", "token counting", "usage quota", "pricing tier", "bi dashboard", "analytics", "subscription"],
        "reason": "Task involves commercial billing, token usage metering, or enterprise analytics dashboards.",
        "spec_file": ".agents/agents/analytics_billing_agent.md",
        "skill_dir": ".agents/skills/tkxel-vault-analytics-billing"
    }
}

def analyze_query(query: str):
    query_lower = query.lower()
    
    # Check coverage among active agents
    active_matches = {}
    for agent_id, data in ACTIVE_AGENTS.items():
        matched_kw = [kw for kw in data["keywords"] if re.search(r'\b' + re.escape(kw) + r'\b', query_lower)]
        if matched_kw:
            active_matches[agent_id] = (data["title"], matched_kw)
            
    # Check if any potential missing agent is suggested
    suggestions = {}
    for agent_id, data in POTENTIAL_AGENTS.items():
        matched_kw = [kw for kw in data["keywords"] if re.search(r'\b' + re.escape(kw) + r'\b', query_lower)]
        if matched_kw:
            suggestions[agent_id] = {
                "title": data["title"],
                "matched_keywords": matched_kw,
                "reason": data["reason"],
                "spec_file": data["spec_file"],
                "skill_dir": data["skill_dir"]
            }
            
    return active_matches, suggestions

def main():
    parser = argparse.ArgumentParser(description="Audit task domain coverage against tkxel Vault agents")
    parser.add_argument("--query", "-q", type=str, required=True, help="Task description or query to analyze")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    active_matches, suggestions = analyze_query(args.query)

    if args.json:
        print(json.dumps({
            "query": args.query,
            "active_matches": active_matches,
            "suggestions": suggestions
        }, indent=2))
        return

    print("=" * 70)
    print("tkxel Vault - Agent Coverage & Gap Analysis")
    print("=" * 70)
    print(f"Task Query: \"{args.query}\"\n")

    if active_matches:
        print(" Active Assigned Agents:")
        for agent_id, (title, kws) in active_matches.items():
            print(f"  - {title} (`{agent_id}`)")
            print(f"    Matches: {', '.join(kws)}")
    else:
        print("  ⚠️ No existing specialized agent directly claims this domain!")

    print()
    if suggestions:
        print("🚨 AGENT GAP DETECTED! Suggested New Specialized Agents:")
        for agent_id, data in suggestions.items():
            print(f"\n  💡 Suggested Role: {data['title']} (`{agent_id}`)")
            print(f"     Reason: {data['reason']}")
            print(f"     Triggered by: {', '.join(data['matched_keywords'])}")
            print(f"     Proposed Spec: `{data['spec_file']}`")
            print(f"     Proposed Skill: `{data['skill_dir']}`")
    else:
        print(" All capability requirements are covered by the existing agent roster.")

    print("=" * 70)

if __name__ == "__main__":
    main()
