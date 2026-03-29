// Microsoft Graph — calendar view (read-only). Events cached with event_id prefix `ms-`.

import dayjs from 'dayjs';
import { microsoftAuth } from './microsoft-auth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface MsGraphEvent {
  id: string;
  subject: string;
  isAllDay?: boolean;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  webLink?: string;
  showAs?: string;
}

type CalResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const microsoftCalendar = {
  listEvents: async (
    timeMin?: string,
    timeMax?: string,
    maxResults = 100,
  ): Promise<CalResult<MsGraphEvent[]>> => {
    const token = await microsoftAuth.getAccessToken();
    if (!token) return { ok: false, error: 'Not signed in to Microsoft' };

    const min = timeMin ?? dayjs().startOf('day').toISOString();
    const max = timeMax ?? dayjs().add(14, 'day').endOf('day').toISOString();
    const params = new URLSearchParams({
      startDateTime: min,
      endDateTime: max,
      $top: String(maxResults),
    });

    try {
      const res = await fetch(`${GRAPH}/me/calendar/calendarView?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      });
      if (!res.ok) {
        const t = await res.text();
        return { ok: false, error: `${res.status}: ${t}` };
      }
      const json = (await res.json()) as { value?: MsGraphEvent[] };
      return { ok: true, data: json.value ?? [] };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
