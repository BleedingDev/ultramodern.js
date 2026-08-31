import { PassThrough, Readable } from 'node:stream';
import {
  abortHeadRender,
  beginHeadRender,
  collectHeadRecord,
  completeHeadRender,
  createHeadChunkProcessor,
  createWebHeadMarkerStripper,
  publishHeadRender,
} from '../src';
import {
  createNodeHeadMarkerStripper,
  createOnceErrorReporter,
  pipeNodeHeadStream,
} from '../src/node';

const marker = (props: Record<string, string>) =>
  `<template data-modern-helmet="${props['data-modern-helmet']}"></template>`;

describe('renderer head transactions', () => {
  it('commits only markers observed in completed output', () => {
    const context = {};
    let published: string[] = [];
    beginHeadRender(context);
    const committed = collectHeadRecord(
      context,
      () => 'committed',
      records => {
        published = records;
      },
    )!;
    collectHeadRecord(
      context,
      () => 'abandoned',
      records => {
        published = records;
      },
    );

    expect(completeHeadRender(context, `a${marker(committed)}b`)).toBe('ab');
    expect(published).toEqual(['committed']);
  });

  it('preserves user templates that are not current transaction markers', () => {
    const context = {};
    beginHeadRender(context);
    const userTemplate =
      '<template data-modern-helmet="h00000000-0000-0000-0000-000000000000000000000000"></template>';

    expect(completeHeadRender(context, userTemplate)).toBe(userTemplate);
  });

  it('does not retain ordinary streaming content', () => {
    const context = {};
    beginHeadRender(context);
    const processor = createHeadChunkProcessor(context);
    const content = 'x'.repeat(128 * 1024);

    expect(processor.push(content)).toBe(content);
    expect(processor.finish()).toBe('');
  });

  it('strips markers split across chunks without corrupting unicode', () => {
    const sampleContext = {};
    beginHeadRender(sampleContext);
    const sampleProps = collectHeadRecord(
      sampleContext,
      () => 'head',
      () => {},
    )!;
    const sampleHtml = `č${marker(sampleProps)}尾`;

    for (let split = 1; split < sampleHtml.length; split += 1) {
      const context = {};
      beginHeadRender(context);
      const props = collectHeadRecord(
        context,
        () => 'head',
        () => {},
      )!;
      const html = `č${marker(props)}尾`;
      const processor = createHeadChunkProcessor(context);
      expect(
        processor.push(html.slice(0, split)) +
          processor.finish(html.slice(split)),
      ).toBe('č尾');
    }
  });

  it('freezes the published shell and ignores late records', () => {
    const context = {};
    let published: string[] = [];
    beginHeadRender(context);
    const shell = collectHeadRecord(
      context,
      () => 'shell',
      records => {
        published = records;
      },
    )!;
    const late = collectHeadRecord(
      context,
      () => 'late',
      records => {
        published = records;
      },
    )!;
    const processor = createHeadChunkProcessor(context);
    expect(processor.push(marker(shell))).toBe('');
    publishHeadRender(context);

    expect(
      collectHeadRecord(
        context,
        () => 'late',
        records => {
          published = records;
        },
      ),
    ).toBeNull();
    expect(processor.finish(marker(late))).toBe('');
    expect(published).toEqual(['shell']);
  });

  it('clears the previous snapshot while rendering and restores it on abort', () => {
    const context = {};
    let published: string[] = [];
    const publish = (records: string[]) => {
      published = records;
    };

    beginHeadRender(context);
    const previous = collectHeadRecord(context, () => 'previous', publish)!;
    completeHeadRender(context, marker(previous));
    expect(published).toEqual(['previous']);

    beginHeadRender(context);
    expect(published).toEqual([]);
    collectHeadRecord(context, () => 'provisional', publish);
    abortHeadRender(context);
    expect(published).toEqual(['previous']);
  });

  it('strips split markers from a web byte stream', async () => {
    const context = {};
    let published: string[] = [];
    beginHeadRender(context);
    const props = collectHeadRecord(
      context,
      () => 'web',
      records => {
        published = records;
      },
    )!;
    const html = `č${marker(props)}尾`;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(html);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 1));
        controller.enqueue(encoded.slice(1, 17));
        controller.enqueue(encoded.slice(17));
        controller.close();
      },
    });

    const output = await new Response(
      source.pipeThrough(createWebHeadMarkerStripper(context)),
    ).text();
    expect(output).toBe('č尾');
    expect(published).toEqual(['web']);
  });

  it('strips split markers from a Node stream', async () => {
    const context = {};
    let published: string[] = [];
    beginHeadRender(context);
    const props = collectHeadRecord(
      context,
      () => 'node',
      records => {
        published = records;
      },
    )!;
    const html = `č${marker(props)}尾`;
    const encoded = Buffer.from(html);
    const stripper = createNodeHeadMarkerStripper(context);
    const output = new Promise<string>((resolve, reject) => {
      let rendered = '';
      stripper.setEncoding('utf8');
      stripper.on('data', chunk => {
        rendered += chunk;
      });
      stripper.on('end', () => resolve(rendered));
      stripper.on('error', reject);
    });
    stripper.write(encoded.subarray(0, 1));
    stripper.write(encoded.subarray(1, 17));
    stripper.end(encoded.subarray(17));

    await expect(output).resolves.toBe('č尾');
    expect(published).toEqual(['node']);
  });

  it('injects one missing terminal marker without truncating multichunk UTF-8', async () => {
    const context = {};
    const terminalMarker = '<!-- shell stream end -->';
    const prefix = Buffer.from('x'.repeat(9 * 1024));
    const unicodeTail = Buffer.from('č尾');
    const input = Buffer.concat([prefix, unicodeTail]);
    beginHeadRender(context);
    const stripper = createNodeHeadMarkerStripper(context, terminalMarker);
    const output = new Promise<string>((resolve, reject) => {
      let rendered = '';
      stripper.setEncoding('utf8');
      stripper.on('data', chunk => {
        rendered += chunk;
      });
      stripper.on('end', () => resolve(rendered));
      stripper.on('error', reject);
    });
    stripper.write(input.subarray(0, prefix.length + 1));
    stripper.write(input.subarray(prefix.length + 1, prefix.length + 3));
    stripper.end(input.subarray(prefix.length + 3));

    await expect(output).resolves.toBe(
      `${input.toString('utf8')}${terminalMarker}`,
    );
  });

  it('does not duplicate a split terminal marker or corrupt its tail', async () => {
    const context = {};
    const terminalMarker = '<!-- shell stream end -->';
    const input = Buffer.from(`shell${terminalMarker}č尾`);
    const markerOffset = Buffer.byteLength('shell') + 7;
    beginHeadRender(context);
    const stripper = createNodeHeadMarkerStripper(context, terminalMarker);
    const output = new Promise<string>((resolve, reject) => {
      let rendered = '';
      stripper.setEncoding('utf8');
      stripper.on('data', chunk => {
        rendered += chunk;
      });
      stripper.on('end', () => resolve(rendered));
      stripper.on('error', reject);
    });
    stripper.write(input.subarray(0, markerOffset));
    stripper.write(input.subarray(markerOffset, input.length - 1));
    stripper.end(input.subarray(input.length - 1));

    await expect(output).resolves.toBe(input.toString('utf8'));
  });

  it('rejects the destination and reports a source error exactly once', async () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const output = new Response(
      Readable.toWeb(destination) as ReadableStream<Uint8Array>,
    ).text();
    const onError = rstest.fn();
    pipeNodeHeadStream({ source, destination, context: {}, onError });

    source.destroy(new Error('source failed'));

    await expect(output).rejects.toThrow('source failed');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('rejects the destination and reports a stripper error exactly once', async () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const output = new Response(
      Readable.toWeb(destination) as ReadableStream<Uint8Array>,
    ).text();
    const onError = rstest.fn();
    pipeNodeHeadStream({
      source,
      destination,
      context: Object.freeze({}),
      onError,
    });

    source.end('trigger frozen-context failure');

    await expect(output).rejects.toThrow('object is not extensible');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports a shared render and stream failure only once', () => {
    const onError = rstest.fn();
    const reportError = createOnceErrorReporter(onError);
    const failure = new Error('shared failure');

    reportError(failure);
    reportError(failure);

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
