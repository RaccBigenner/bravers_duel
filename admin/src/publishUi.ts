/** 新規公開は全preflight合格後だけ。server管理のpublishing lock中はcleanup再開を妨げない。 */
export function canStartOrResumePublish(
  status: string | undefined,
  preflightAllGreen: boolean,
): boolean {
  return status === 'publishing' || preflightAllGreen;
}
