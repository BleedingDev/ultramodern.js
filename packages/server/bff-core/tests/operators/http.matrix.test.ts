import { z } from 'zod';
import {
  Api,
  Data,
  Headers,
  type Operator,
  Params,
  Post,
  Query,
  Upload,
  ValidationError,
} from '../../src';

type MatrixCase = {
  label: string;
  operator: Operator<any, any>;
  validInput: Record<string, unknown>;
  invalidInput: Record<string, unknown>;
  expectedHandlerInput: Record<string, unknown>;
};

const expectValidationError = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ status: 400 });
    expect((error as Error).message).not.toBe('');
    return;
  }

  throw new Error('Expected handler to reject with ValidationError');
};

describe('http operator input matrix', () => {
  const cases: MatrixCase[] = [
    {
      label: 'Body/Data',
      operator: Data(
        z.object({
          count: z.string().transform(value => Number(value)),
          nested: z.object({
            enabled: z.literal('yes').transform(() => true),
          }),
        }),
      ),
      validInput: {
        data: { count: '7', nested: { enabled: 'yes' } },
      },
      invalidInput: {
        data: { count: 7, nested: { enabled: 'yes' } },
      },
      expectedHandlerInput: {
        data: { count: 7, nested: { enabled: true } },
      },
    },
    {
      label: 'Query',
      operator: Query(
        z.object({
          page: z
            .string()
            .regex(/^\d+$/)
            .transform(value => Number(value)),
          tag: z.string().transform(value => value.toUpperCase()),
        }),
      ),
      validInput: {
        query: { page: '3', tag: 'modern' },
      },
      invalidInput: {
        query: { page: 'three', tag: 'modern' },
      },
      expectedHandlerInput: {
        query: { page: 3, tag: 'MODERN' },
      },
    },
    {
      label: 'Params',
      operator: Params(
        z.object({
          id: z
            .string()
            .uuid()
            .transform(value => value.slice(0, 8)),
        }),
      ),
      validInput: {
        params: { id: '3d594650-3436-42bd-a093-1164a00d7b3f' },
      },
      invalidInput: {
        params: { id: 'not-a-uuid' },
      },
      expectedHandlerInput: {
        params: { id: '3d594650' },
      },
    },
    {
      label: 'Headers',
      operator: Headers(
        z.object({
          'x-request-id': z.string().min(3),
          'x-enabled': z
            .enum(['true', 'false'])
            .transform(value => value === 'true'),
        }),
      ),
      validInput: {
        headers: { 'x-request-id': 'req-123', 'x-enabled': 'true' },
      },
      invalidInput: {
        headers: { 'x-request-id': 'req-123', 'x-enabled': 'yes' },
      },
      expectedHandlerInput: {
        headers: { 'x-request-id': 'req-123', 'x-enabled': true },
      },
    },
    {
      label: 'Upload',
      operator: Upload(
        '/upload',
        z.object({
          avatar: z.string().min(1),
          size: z
            .string()
            .transform(value => Number(value))
            .pipe(z.number().min(1)),
        }),
      ),
      validInput: {
        formData: { avatar: 'logo.svg', size: '42' },
      },
      invalidInput: {
        formData: { avatar: 'logo.svg', size: '0' },
      },
      expectedHandlerInput: {
        formData: { avatar: 'logo.svg', size: 42 },
      },
    },
  ];

  for (const testCase of cases) {
    test(`${testCase.label} validates and injects the exact handler input`, async () => {
      const observedInputs: unknown[] = [];
      const handler = Api(testCase.operator, async input => {
        observedInputs.push(input);
        return input;
      });

      const result = await handler(testCase.validInput as any);

      expect(result).toEqual(testCase.expectedHandlerInput);
      expect(observedInputs).toEqual([testCase.expectedHandlerInput]);
    });

    test(`${testCase.label} rejects invalid input as a validation error`, async () => {
      const observedInputs: unknown[] = [];
      const handler = Api(testCase.operator, async input => {
        observedInputs.push(input);
        return input;
      });

      await expectValidationError(() => handler(testCase.invalidInput as any));

      expect(observedInputs).toEqual([]);
    });
  }

  test('composes validators in route declaration order before the handler', async () => {
    const order: string[] = [];
    const observedInputs: unknown[] = [];

    const handler = Api(
      Post('/matrix'),
      Headers(
        z.object({
          'x-mode': z.string().transform(value => {
            order.push('headers');
            return value === 'on';
          }),
        }),
      ),
      Params(
        z.object({
          slug: z.string().transform(value => {
            order.push('params');
            return value.toLowerCase();
          }),
        }),
      ),
      Data(
        z.object({
          title: z.string().transform(value => {
            order.push('body');
            return value.toUpperCase();
          }),
        }),
      ),
      Query(
        z.object({
          search: z.string().transform(value => {
            order.push('query');
            return value.trim();
          }),
        }),
      ),
      async input => {
        order.push('handler');
        observedInputs.push(input);
        return input;
      },
    );

    const expectedHandlerInput = {
      headers: { 'x-mode': true },
      params: { slug: 'modern-js' },
      data: { title: 'BFF' },
      query: { search: 'operators' },
    };

    const result = await handler({
      headers: { 'x-mode': 'on' },
      params: { slug: 'Modern-JS' },
      data: { title: 'bff' },
      query: { search: '  operators  ' },
    } as any);

    expect(order).toEqual(['headers', 'params', 'body', 'query', 'handler']);
    expect(result).toEqual(expectedHandlerInput);
    expect(observedInputs).toEqual([expectedHandlerInput]);
  });
});
