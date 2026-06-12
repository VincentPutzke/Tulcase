/**
 * Language Model Tools for the Tulcase Pipe feature.
 *
 * Lets AI agents inspect pipeline status, read job logs (for failure
 * analysis), list scopes, and — with user confirmation — trigger pipelines.
 */

import * as vscode from 'vscode';
import type { PipeFeature } from '../pipe/pipe-feature';
import type { Job, Pipeline } from '../pipe/models';
import { stripAnsi } from '../pipe/log-poller';
import { describeApiError } from '../pipe/gitlab-client';
import { json, text } from './tools';

// ── List scopes ──────────────────────────────────────────────────────────────

class ListPipeScopesTool implements vscode.LanguageModelTool<object> {
    constructor(private readonly pipe: PipeFeature) {}

    async invoke(): Promise<vscode.LanguageModelToolResult> {
        const scopes = await this.pipe.scopeStore.listScopes();
        return json({
            count: scopes.length,
            scopes: scopes.map(s => ({
                id: s.id,
                label: s.label,
                projects: s.projects,
                enabled: s.enabled,
                follow: s.follow,
                tags: s.tags,
                branchFilter: s.branchFilter,
                statusFilter: s.statusFilter,
                userFilter: s.userFilter,
                nameContains: s.nameContains,
                sinceHours: s.sinceHours,
                lastN: s.lastN,
                logRules: s.logRules,
            })),
        });
    }
}

// ── Pipeline status ──────────────────────────────────────────────────────────

interface PipeStatusInput {
    scope?: string;
    status?: string;
    refresh?: boolean;
    limit?: number;
}

class PipeStatusTool implements vscode.LanguageModelTool<PipeStatusInput> {
    constructor(private readonly pipe: PipeFeature) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<PipeStatusInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input ?? {};
        const scopes = (await this.pipe.scopeStore.listScopes()).filter(s => s.enabled);
        if (scopes.length === 0) {
            return text('No enabled pipe scopes configured. Use the Pipe Scopes view to add one.');
        }

        // Fetch fresh data when asked or when nothing has been polled yet.
        const empty = scopes.every(s => this.pipe.pipelineStore.scopeSnapshot(s.id).length === 0);
        if (input.refresh || empty) {
            await this.pipe.poller.tickNow();
        }

        const limit = Math.max(1, Math.min(50, input.limit ?? 10));
        const wanted = input.scope?.toLowerCase();
        const out: Array<Record<string, unknown>> = [];

        for (const scope of scopes) {
            if (wanted && scope.label.toLowerCase() !== wanted && scope.id !== input.scope) {
                continue;
            }
            let pipelines = this.pipe.pipelineStore.scopeSnapshot(scope.id);
            if (input.status) {
                pipelines = pipelines.filter(p => p.status === input.status);
            }
            out.push({
                scope: scope.label,
                scopeId: scope.id,
                follow: scope.follow,
                pipelines: pipelines.slice(0, limit).map(serializePipeline),
            });
        }

        if (out.length === 0) {
            return text(`No scope matched "${input.scope}". Use tulcase_pipe_list_scopes for valid labels.`);
        }
        return json(out);
    }
}

function serializePipeline(p: Pipeline) {
    return {
        id: p.id,
        iid: p.iid,
        project: p.projectPath,
        ref: p.ref,
        sha: p.sha.slice(0, 8),
        status: p.status,
        user: p.user?.username,
        updatedAt: p.updatedAt,
        webUrl: p.webUrl,
        jobs: flattenJobs(p.jobs).map(j => ({
            id: j.id,
            name: j.name,
            stage: j.stage,
            status: j.status,
            duration: j.duration,
            allowFailure: j.allowFailure || undefined,
            bridge: j.isBridge || undefined,
        })),
    };
}

function flattenJobs(jobs: ReadonlyArray<Job>): Job[] {
    const out: Job[] = [];
    for (const j of jobs) {
        out.push(j);
        if (j.children) { out.push(...flattenJobs(j.children)); }
    }
    return out;
}

// ── Job log ──────────────────────────────────────────────────────────────────

interface PipeJobLogInput {
    jobId: number;
    tailLines?: number;
}

class PipeJobLogTool implements vscode.LanguageModelTool<PipeJobLogInput> {
    constructor(private readonly pipe: PipeFeature) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<PipeJobLogInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { jobId, tailLines } = options.input;
        const job = this.pipe.pipelineStore.findJob(jobId);
        if (!job) {
            return text(
                `Job ${jobId} is not in the current pipeline data. ` +
                'Use tulcase_pipe_status (with refresh: true) to list current jobs.',
            );
        }
        if (job.isBridge) {
            return text(`Job ${jobId} ("${job.name}") is a trigger job and has no log.`);
        }
        try {
            const chunk = await this.pipe.client.getJobTrace(job.projectId, job.id, 0);
            const clean = stripAnsi(chunk.text);
            const lines = clean.split('\n');
            const tail = Math.max(10, Math.min(2000, tailLines ?? 200));
            const sliced = lines.length > tail ? lines.slice(lines.length - tail) : lines;
            const header =
                `# ${job.projectPath} · ${job.name} (job ${job.id}, status: ${job.status})\n` +
                (lines.length > tail ? `# …showing last ${tail} of ${lines.length} lines\n` : '');
            return text(header + sliced.join('\n'));
        } catch (err) {
            return text(`Failed to fetch log: ${describeApiError(err)}`);
        }
    }
}

// ── Trigger pipeline ─────────────────────────────────────────────────────────

interface PipeTriggerInput {
    project: string;
    ref: string;
    variables?: Array<{ key: string; value: string }>;
}

class PipeTriggerTool implements vscode.LanguageModelTool<PipeTriggerInput> {
    constructor(private readonly pipe: PipeFeature) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<PipeTriggerInput>,
    ): vscode.PreparedToolInvocation {
        const { project, ref, variables } = options.input;
        const vars = variables?.length
            ? ` with variables ${variables.map(v => v.key).join(', ')}`
            : '';
        return {
            invocationMessage: `Triggering pipeline on ${project} · ${ref}`,
            confirmationMessages: {
                title: 'Run GitLab pipeline?',
                message: new vscode.MarkdownString(
                    `Trigger a new pipeline on **${project}** at ref \`${ref}\`${vars}?`,
                ),
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<PipeTriggerInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { project, ref, variables } = options.input;
        if (!project?.trim() || !ref?.trim()) {
            throw new Error('Both project and ref are required.');
        }
        try {
            const pipeline = await this.pipe.client.createPipeline(
                project.trim(),
                ref.trim(),
                (variables ?? []).map(v => ({ key: v.key, value: v.value })),
            );
            void this.pipe.poller.tickNow();
            return json({
                ok: true,
                id: pipeline.id,
                iid: pipeline.iid,
                status: pipeline.status,
                webUrl: pipeline.webUrl,
            });
        } catch (err) {
            return text(`Failed to trigger pipeline: ${describeApiError(err)}`);
        }
    }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerPipeChatTools(
    context: vscode.ExtensionContext,
    pipe: PipeFeature,
): void {
    context.subscriptions.push(
        vscode.lm.registerTool('tulcase_pipe_list_scopes', new ListPipeScopesTool(pipe)),
        vscode.lm.registerTool('tulcase_pipe_status', new PipeStatusTool(pipe)),
        vscode.lm.registerTool('tulcase_pipe_job_log', new PipeJobLogTool(pipe)),
        vscode.lm.registerTool('tulcase_pipe_trigger_pipeline', new PipeTriggerTool(pipe)),
    );
}
