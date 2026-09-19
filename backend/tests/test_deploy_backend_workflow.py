"""Regression guard for the ECS task-definition registration in deploy-backend."""

from pathlib import Path


def test_deploy_workflow_registers_task_definition_from_validated_temp_file() -> None:
    workflow = (
        Path(__file__).resolve().parents[2] / ".github" / "workflows" / "deploy-backend.yml"
    ).read_text(encoding="utf-8")

    assert 'TASK_DEFINITION_JSON="${RUNNER_TEMP}/task-definition.json"' in workflow
    assert 'jq -e . "${TASK_DEFINITION_JSON}" > /dev/null' in workflow
    assert '--cli-input-json "file://${TASK_DEFINITION_JSON}"' in workflow
    assert "--cli-input-json file:///dev/stdin" not in workflow
