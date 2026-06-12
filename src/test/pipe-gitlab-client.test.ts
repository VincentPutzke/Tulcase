import { describe, it, expect, vi } from 'vitest';
import { GitLabClient, GitLabApiError, describeApiError } from '../pipe/gitlab-client';

function clientWith(fakeFetch: typeof fetch) {
    return new GitLabClient(
        { baseUrl: () => 'https://gitlab.example.com', getToken: async () => 'tok' },
        { fetch: fakeFetch, maxRetries: 2, maxRetryAfterSeconds: 0 },
    );
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('GitLabClient — base URL handling', () => {
    it('strips trailing slash and /api/v4 suffix when building URLs', async () => {
        const calls: string[] = [];
        const fakeFetch = vi.fn(async (url: string) => {
            calls.push(url);
            return jsonResponse({ username: 'me' });
        }) as unknown as typeof fetch;
        const c = new GitLabClient(
            { baseUrl: () => 'https://gitlab.example.com/api/v4/', getToken: async () => 't' },
            { fetch: fakeFetch },
        );
        await c.validateToken();
        expect(calls[0]).toBe('https://gitlab.example.com/api/v4/user');
    });
});

describe('GitLabClient — 429 retry', () => {
    it('retries when server returns 429 and eventually succeeds', async () => {
        let count = 0;
        const fakeFetch = vi.fn(async () => {
            count++;
            if (count === 1) {
                return new Response('rate limited', {
                    status: 429,
                    headers: { 'retry-after': '0' },
                });
            }
            return jsonResponse({ username: 'me' });
        }) as unknown as typeof fetch;
        const c = clientWith(fakeFetch);
        const res = await c.validateToken();
        expect(res.username).toBe('me');
        expect(count).toBe(2);
    });
});

describe('GitLabClient — getJobTrace replace flag', () => {
    it('flags replace=true when server returns 200 with offset>0', async () => {
        const fakeFetch = vi.fn(async () => new Response('full body', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
        })) as unknown as typeof fetch;
        const c = clientWith(fakeFetch);
        const chunk = await c.getJobTrace(1, 99, /*offset*/ 50);
        expect(chunk.replace).toBe(true);
        expect(chunk.text).toBe('full body');
    });

    it('appends without replace flag for 206 responses', async () => {
        const fakeFetch = vi.fn(async () => new Response('tail', {
            status: 206,
            headers: { 'content-range': 'bytes 50-53/54' },
        })) as unknown as typeof fetch;
        const c = clientWith(fakeFetch);
        const chunk = await c.getJobTrace(1, 99, 50);
        expect(chunk.replace).toBeFalsy();
        expect(chunk.nextOffset).toBe(54);
    });
});

describe('GitLabClient — write actions', () => {
    it('createPipeline POSTs ref, variables and inputs', async () => {
        const seen: Array<{ url: string; method?: string; body?: string }> = [];
        const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
            seen.push({ url, method: init?.method, body: init?.body as string });
            if (url.includes('/pipeline') && init?.method === 'POST') {
                return jsonResponse({
                    id: 7, iid: 3, ref: 'main', sha: 'abc', status: 'created',
                    web_url: 'http://x', created_at: '', updated_at: '',
                });
            }
            return jsonResponse({ id: 1, path_with_namespace: 'g/p' });
        }) as unknown as typeof fetch;

        const c = clientWith(fakeFetch);
        const pipeline = await c.createPipeline(
            'g/p', 'main',
            [{ key: 'ENV', value: 'prod' }, { key: 'CONF', value: 'x', variableType: 'file' }],
            { environment: 'staging' },
        );
        expect(pipeline.id).toBe(7);

        const post = seen.find(s => s.method === 'POST')!;
        expect(post.url).toBe('https://gitlab.example.com/api/v4/projects/g%2Fp/pipeline');
        const body = JSON.parse(post.body!);
        expect(body.ref).toBe('main');
        expect(body.variables).toEqual([
            { key: 'ENV', value: 'prod', variable_type: 'env_var' },
            { key: 'CONF', value: 'x', variable_type: 'file' },
        ]);
        expect(body.inputs).toEqual({ environment: 'staging' });
    });

    it('createPipeline omits empty variables and inputs', async () => {
        let body: Record<string, unknown> = {};
        const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (init?.method === 'POST') {
                body = JSON.parse(init.body as string);
                return jsonResponse({
                    id: 1, ref: 'main', sha: 'a', status: 'created',
                    web_url: '', created_at: '', updated_at: '',
                });
            }
            return jsonResponse({ id: 1, path_with_namespace: 'g/p' });
        }) as unknown as typeof fetch;
        await clientWith(fakeFetch).createPipeline('g/p', 'main');
        expect(body).toEqual({ ref: 'main' });
    });

    it('retry / cancel / play hit the expected endpoints', async () => {
        const urls: string[] = [];
        const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (init?.method === 'POST') { urls.push(url); }
            return jsonResponse({});
        }) as unknown as typeof fetch;
        const c = clientWith(fakeFetch);
        await c.retryPipeline('g/p', 5);
        await c.cancelPipeline(42, 5);
        await c.retryJob('g/p', 9);
        await c.cancelJob('g/p', 9);
        await c.playJob('g/p', 9, [{ key: 'K', value: 'V' }]);
        expect(urls).toEqual([
            'https://gitlab.example.com/api/v4/projects/g%2Fp/pipelines/5/retry',
            'https://gitlab.example.com/api/v4/projects/42/pipelines/5/cancel',
            'https://gitlab.example.com/api/v4/projects/g%2Fp/jobs/9/retry',
            'https://gitlab.example.com/api/v4/projects/g%2Fp/jobs/9/cancel',
            'https://gitlab.example.com/api/v4/projects/g%2Fp/jobs/9/play',
        ]);
    });

    it('playJob sends job_variables_attributes', async () => {
        let body: Record<string, unknown> = {};
        const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
            if (init?.method === 'POST') { body = JSON.parse(init.body as string); }
            return jsonResponse({});
        }) as unknown as typeof fetch;
        await clientWith(fakeFetch).playJob('g/p', 9, [{ key: 'K', value: 'V' }]);
        expect(body.job_variables_attributes).toEqual([{ key: 'K', value: 'V' }]);
    });
});

describe('GitLabClient — pickers', () => {
    it('listBranches sorts the default branch first', async () => {
        const fakeFetch = vi.fn(async () => jsonResponse([
            { name: 'feature/a', default: false },
            { name: 'main', default: true },
        ])) as unknown as typeof fetch;
        const branches = await clientWith(fakeFetch).listBranches('g/p');
        expect(branches[0].name).toBe('main');
    });

    it('searchProjects maps results', async () => {
        const fakeFetch = vi.fn(async (url: string) => {
            expect(url).toContain('membership=true');
            expect(url).toContain('search=api');
            return jsonResponse([
                { id: 1, path_with_namespace: 'g/api', description: 'd' },
            ]);
        }) as unknown as typeof fetch;
        const hits = await clientWith(fakeFetch).searchProjects('api');
        expect(hits).toEqual([{ id: 1, pathWithNamespace: 'g/api', description: 'd' }]);
    });
});

describe('describeApiError', () => {
    it('extracts message from a JSON error body', () => {
        const err = new GitLabApiError('GitLab 400', 400, 'http://x', '{"message":"insufficient scope"}');
        expect(describeApiError(err)).toBe('400: insufficient scope');
    });

    it('falls back to the error message for non-JSON bodies', () => {
        const err = new GitLabApiError('GitLab 500 boom', 500, 'http://x', '<html>');
        expect(describeApiError(err)).toBe('GitLab 500 boom');
    });

    it('handles plain errors', () => {
        expect(describeApiError(new Error('nope'))).toBe('nope');
    });
});
