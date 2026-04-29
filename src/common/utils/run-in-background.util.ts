import { EventEmitter } from 'events';

export const BackgroundJobEmitter = new EventEmitter();

/**
 * Fire-and-forget helper.
 *
 * Accepts a job name and any number of Promises (activity logs, cache invalidations,
 * gamification jobs, webhook calls, etc.) and runs them in the background
 * without blocking the caller's response.
 *
 * - Errors inside the tasks are caught and logged to stderr so a failing
 *   side-effect can NEVER crash the main request flow.
 * - Every rejected task is reported via console.error and emits a global event
 *   so that the system can record it in the Activity Logs.
 *
 * Usage:
 *   runInBackground(
 *     'Department Create',
 *     this.activityLogs.log({ ..., status: 'success' }),
 *     this.cacheManager.del('some_key'),
 *   );
 *   return response; // returned immediately — tasks run in background
 */
export function runInBackground(jobName: string, ...tasks: Promise<any>[]): void {
  Promise.allSettled(tasks).then((results) => {
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const errorMessage = result.reason?.message || String(result.reason);
        console.error(
          `[runInBackground] Job '${jobName}' - Task #${index + 1} of ${tasks.length} failed:`,
          result.reason,
        );

        BackgroundJobEmitter.emit('jobFailed', {
          action: 'background_job_error',
          module: 'system',
          entity: 'BackgroundJob',
          description: `Background task #${index + 1} in '${jobName}' failed`,
          errorMessage: errorMessage,
          status: 'failure',
        });
      }
    });
  });
}
