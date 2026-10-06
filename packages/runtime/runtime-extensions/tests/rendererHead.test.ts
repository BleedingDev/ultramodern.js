import { PassThrough, Readable } from 'node:stream';
import {
  abortHeadRender,
  beginHeadRender,
  collectHeadRecord,
  completeHeadRender,
  createHeadChunkProcessor,
  LATE_HEAD_MESSAGE,
  publishHeadRender,
} from '../src';
import { createNodeHeadMarkerStripper, pipeNodeHeadStream } from '../src/node';

const marker = (props: Record<string, string>) =>
  `<template data-modern-helmet="${props['data-modern-helmet']}"></template>`;

describe('renderer head transactions', () => {
  it('commits only markers observed in completed output', () => {
    const context = {};
    let published: string[] = [];
    beginHeadRender(context, () => {});
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

  it('reports head records whose markers commit after the seal', () => {
    const context = {};
    const reports: string[] = [];
    let published: string[] = [];
    const publish = (records: string[]) => {
      published = records;
    };
    beginHeadRender(context, message => reports.push(message));
    const shell = collectHeadRecord(context, () => 'shell', publish)!;
    // A boundary rendered before the seal but flushed after it.
    const flushedLate = collectHeadRecord(context, () => 'flushed', publish)!;
    const processor = createHeadChunkProcessor(context);
    expect(processor.push(`a${marker(shell)}`)).toBe('a');
    publishHeadRender(context);
    // A boundary rendered after the seal.
    const renderedLate = collectHeadRecord(context, () => 'rendered', publish)!;
    // A retry that renders a Helmet and then suspends again never commits.
    collectHeadRecord(context, () => 'discarded', publish);
    expect(reports).toEqual([]);

    expect(processor.push(`b${marker(flushedLate)}${marker(shell)}`)).toBe('b');
    expect(processor.finish(`c${marker(renderedLate)}`)).toBe('c');

    expect(published).toEqual(['shell']);
    expect(reports).toEqual([LATE_HEAD_MESSAGE]);
  });

  it('does not report a late Helmet whose boundary never commits', () => {
    const context = {};
    const reports: string[] = [];
    beginHeadRender(context, message => reports.push(message));
    publishHeadRender(context);
    collectHeadRecord(
      context,
      () => 'discarded',
      () => {},
    );
    expect(completeHeadRender(context, 'done')).toBe('done');
    expect(reports).toEqual([]);
  });

  it('preserves user templates that are not current transaction markers', () => {
    const context = {};
    beginHeadRender(context, () => {});
    const userTemplate =
      '<template data-modern-helmet="h00000000-0000-0000-0000-000000000000000000000000"></template>';

    expect(completeHeadRender(context, userTemplate)).toBe(userTemplate);
  });

  it('strips markers split across chunks without corrupting unicode', () => {
    const sampleContext = {};
    beginHeadRender(sampleContext, () => {});
    const sampleProps = collectHeadRecord(
      sampleContext,
      () => 'head',
      () => {},
    )!;
    const sampleHtml = `č${marker(sampleProps)}尾`;

    for (let split = 1; split < sampleHtml.length; split += 1) {
      const context = {};
      beginHeadRender(context, () => {});
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

  it('clears the previous snapshot while rendering and restores it on abort', () => {
    const context = {};
    let published: string[] = [];
    const publish = (records: string[]) => {
      published = records;
    };

    beginHeadRender(context, () => {});
    const previous = collectHeadRecord(context, () => 'previous', publish)!;
    completeHeadRender(context, marker(previous));
    expect(published).toEqual(['previous']);

    beginHeadRender(context, () => {});
    expect(published).toEqual([]);
    collectHeadRecord(context, () => 'provisional', publish);
    abortHeadRender(context);
    expect(published).toEqual(['previous']);
  });

  it('strips split markers from a Node stream', async () => {
    const context = {};
    let published: string[] = [];
    beginHeadRender(context, () => {});
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
    beginHeadRender(context, () => {});
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
    beginHeadRender(context, () => {});
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
});
