/** Promise sleep (ms). Dùng thay cho (page as any).sleep khi không dùng undetected-browser. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
