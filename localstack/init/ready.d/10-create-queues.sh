#!/bin/sh
set -eu

export AWS_DEFAULT_REGION=us-east-1

DLQ_NAME="wager-transactions-dlq.fifo"
QUEUE_NAME="wager-transactions.fifo"

echo "Criando a Dead Letter Queue..."

DLQ_URL=$(awslocal sqs create-queue \
  --queue-name "$DLQ_NAME" \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}' \
  --query 'QueueUrl' \
  --output text)

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

REDRIVE_POLICY=$(printf \
  '{"deadLetterTargetArn":"%s","maxReceiveCount":"5"}' \
  "$DLQ_ARN")

ESCAPED_POLICY=$(printf '%s' "$REDRIVE_POLICY" | sed 's/\\/\\\\/g; s/"/\\"/g')

ATTRIBUTES=$(printf \
  '{"FifoQueue":"true","ContentBasedDeduplication":"true","VisibilityTimeout":"30","RedrivePolicy":"%s"}' \
  "$ESCAPED_POLICY")

echo "Criando a fila principal..."

awslocal sqs create-queue \
  --queue-name "$QUEUE_NAME" \
  --attributes "$ATTRIBUTES"

awslocal sqs create-queue \
  --queue-name "wager-integration-events.fifo" \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}'

echo "Filas configuradas com sucesso."
