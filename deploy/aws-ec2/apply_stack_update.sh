#!/usr/bin/env bash
set -euo pipefail

ADMIN_CIDR="${1:?usage: apply_stack_update.sh <admin-cidr>}"
REGION="${AWS_REGION:-ap-south-1}"
STACK_NAME="${STACK_NAME:-hariom-erp-production-v2}"
TEMPLATE_FILE="${TEMPLATE_FILE:-infrastructure.yaml}"
RESULT_FILE="${RESULT_FILE:-${HOME}/hariom-stack-update.result}"

aws cloudformation validate-template \
  --region "${REGION}" \
  --template-body "file://${TEMPLATE_FILE}" >/dev/null

set +e
update_output="$(aws cloudformation update-stack \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-body "file://${TEMPLATE_FILE}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    "ParameterKey=AdminCidr,ParameterValue=${ADMIN_CIDR}" \
    "ParameterKey=SSHPublicKey,UsePreviousValue=true" \
    "ParameterKey=InstanceType,UsePreviousValue=true" \
    "ParameterKey=UbuntuAmi,UsePreviousValue=true" 2>&1)"
update_status="$?"
set -e

if [[ "${update_status}" -ne 0 ]]; then
  if grep -q "No updates are to be performed" <<<"${update_output}"; then
    printf 'NO_CHANGES\n' >"${RESULT_FILE}"
    exit 0
  fi
  printf 'UPDATE_REQUEST_FAILED\n%s\n' "${update_output}" >"${RESULT_FILE}"
  exit "${update_status}"
fi

aws cloudformation wait stack-update-complete \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}"

aws cloudformation describe-stacks \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].{Status:StackStatus,Updated:LastUpdatedTime,Outputs:Outputs}' \
  --output json >"${RESULT_FILE}"
