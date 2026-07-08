import {
  type EffectViewSelection,
  mask,
  runEffectView,
  view,
} from '../src/runtime/effect-client';

type UserPayload = {
  id: string;
  profile: {
    name: string;
    email: string;
    social: {
      github: string;
      twitter: string;
    };
  };
  posts: Array<{
    id: string;
    title: string;
    comments: Array<{
      id: string;
      body: string;
    }>;
  }>;
  nullableMeta: {
    source: string;
  } | null;
  tags: string[];
};

const userPayload: UserPayload = {
  id: '42',
  profile: {
    name: 'Ada',
    email: 'ada@example.com',
    social: {
      github: 'ada',
      twitter: '@ada',
    },
  },
  posts: [
    {
      id: 'post-1',
      title: 'one',
      comments: [
        {
          id: 'comment-1',
          body: 'hi',
        },
      ],
    },
    {
      id: 'post-2',
      title: 'two',
      comments: [],
    },
  ],
  nullableMeta: null,
  tags: ['typescript', 'effect'],
};

describe('effect-client view helpers', () => {
  test('mask picks nested fields and arrays', () => {
    const selected = mask(
      userPayload,
      view<UserPayload>()({
        id: true,
        profile: {
          name: true,
          social: {
            github: true,
          },
        },
        posts: {
          id: true,
          comments: {
            body: true,
          },
        },
      }),
    );

    expect(selected).toEqual({
      id: '42',
      profile: {
        name: 'Ada',
        social: {
          github: 'ada',
        },
      },
      posts: [
        {
          id: 'post-1',
          comments: [
            {
              body: 'hi',
            },
          ],
        },
        {
          id: 'post-2',
          comments: [],
        },
      ],
    });
  });

  test('mask preserves null fields and primitive arrays', () => {
    const selected = mask(
      userPayload,
      view<UserPayload>()({
        nullableMeta: {
          source: true,
        },
        tags: true,
      }),
    );

    expect(selected).toEqual({
      nullableMeta: null,
      tags: ['typescript', 'effect'],
    });
  });

  test('mask ignores explicitly undefined selection entries', () => {
    const selected = mask(
      userPayload,
      view<UserPayload>()({
        id: true,
        profile: undefined,
      }),
    );

    expect(selected).toEqual({
      id: '42',
    });
  });

  test('mask ignores invalid runtime selection values', () => {
    const selected = mask(userPayload, {
      id: true,
      profile: null,
      posts: false,
    } as unknown as EffectViewSelection<UserPayload>);

    expect(selected).toEqual({
      id: '42',
    });
  });

  test('runEffectView maps promise result with selection', async () => {
    const selected = await runEffectView(
      Promise.resolve(userPayload),
      view<UserPayload>()({
        profile: {
          email: true,
        },
      }),
    );

    expect(selected).toEqual({
      profile: {
        email: 'ada@example.com',
      },
    });
  });
});
