
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';

@Injectable()
export class SqsService implements OnModuleDestroy {
  private readonly client = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });

  private readonly queueUrl =
    process.env.SQS_QUEUE_URL ??
    'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions.fifo';
  private readonly eventsQueueUrl = process.env.SQS_EVENTS_QUEUE_URL ??
    'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-integration-events.fifo';
  private readonly dlqUrl = process.env.SQS_DLQ_URL ??
    'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions-dlq.fifo';

  async publishTransaction(
    message: Record<string, unknown>,
    walletId: string,
    transactionId: string,
  ): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.eventsQueueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: walletId,
        MessageDeduplicationId: transactionId,
      }),
    );
  }

  async receiveMessages(): Promise<Message[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 30,
      }),
    );

    return response.Messages ?? [];
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  async checkReady(): Promise<void> {
    const { GetQueueAttributesCommand } = await import('@aws-sdk/client-sqs');
    await this.client.send(new GetQueueAttributesCommand({
      QueueUrl: this.queueUrl, AttributeNames: ['QueueArn'],
    }));
  }

  async getDlqDepth(): Promise<number> {
    const { GetQueueAttributesCommand } = await import('@aws-sdk/client-sqs');
    const response = await this.client.send(new GetQueueAttributesCommand({
      QueueUrl: this.dlqUrl, AttributeNames: ['ApproximateNumberOfMessages'],
    }));
    return Number(response.Attributes?.ApproximateNumberOfMessages ?? 0);
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
