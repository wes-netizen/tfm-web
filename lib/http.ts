export function apiUrl(path: string) {
    return `${window.location.origin}${path}`;
  }
  
  async function handle<T>(res: Response): Promise<T> {
    if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
    return (await res.json()) as T;
  }
  
  export async function getJSON<T>(path: string): Promise<T> {
    const res = await fetch(apiUrl(path), { credentials: "same-origin" });
    return handle<T>(res);
  }
  
  export async function postJSON<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return handle<T>(res);
  }