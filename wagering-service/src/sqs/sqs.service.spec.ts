
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

import { SqsService } from './sqs.service.js';

describe('SqsService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publica uma mensagem na fila FIFO', async () => {
    const sendSpy = vi
      .spyOn(SQSClient.prototype, 'send')
      .mockResolvedValue({} as never);

    const service = new SqsService();

    await service.publishTransaction(
      { transactionId: 'transaction-001', type: 'LOSS' },
      'wallet-001',
      'transaction-001',
    );

    expect(sendSpy).toHaveBeenCalledOnce();

    const command = sendSpy.mock.calls[0]?.[0];

    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command?.input).toEqual(
      expect.objectContaining({
        MessageBody: JSON.stringify({
          transactionId: 'transaction-001',
          type: 'LOSS',
        }),
        MessageGroupId: 'wallet-001',
        MessageDeduplicationId: 'transaction-001',
      }),
    );

    service.onModuleDestroy();
  });

  it('recebe mensagens da fila', async () => {
    const message = {
      MessageId: 'message-001',
      ReceiptHandle: 'receipt-001',
      Body: '{"transactionId":"transaction-001"}',
    };

    const sendSpy = vi
      .spyOn(SQSClient.prototype, 'send')
      .mockResolvedValue({ Messages: [message] } as never);

    const service = new SqsService();

    const result = await service.receiveMessages();

    expect(result).toEqual([message]);
    expect(sendSpy).toHaveBeenCalledOnce();

    const command = sendSpy.mock.calls[0]?.[0];

    expect(command).toBeInstanceOf(ReceiveMessageCommand);
    expect(command?.input).toEqual(
      expect.objectContaining({
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 30,
      }),
    );

    service.onModuleDestroy();
  });

  it('retorna uma lista vazia quando não há mensagens', async () => {
    vi.spyOn(SQSClient.prototype, 'send')
      .mockResolvedValue({} as never);

    const service = new SqsService();

    await expect(service.receiveMessages()).resolves.toEqual([]);

    service.onModuleDestroy();
  });

  it('remove uma mensagem usando o ReceiptHandle', async () => {
    const sendSpy = vi
      .spyOn(SQSClient.prototype, 'send')
      .mockResolvedValue({} as never);

    const service = new SqsService();

    await service.deleteMessage('receipt-001');

    expect(sendSpy).toHaveBeenCalledOnce();

    const command = sendSpy.mock.calls[0]?.[0];

    expect(command).toBeInstanceOf(DeleteMessageCommand);
    expect(command?.input).toEqual(
      expect.objectContaining({
        ReceiptHandle: 'receipt-001',
      }),
    );

    service.onModuleDestroy();
  });
});
