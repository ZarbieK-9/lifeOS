// Google Calendar v3 REST API client
// Direct mobile → Google API (no backend proxy)
// Follows same Result<T> pattern as src/services/api.ts

import { googleAuth } from './google-auth';
import dayjs from 'dayjs';

const BASE = 'https://www.googleapis.com/calendar/v3';

// ── Types ──

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status: string;
  htmlLink?: string;
  created: string;
  updated: string;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
}

type CalResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ── Authenticated fetch ──

async function gCalFetch<T>(path: string, options: RequestInit = {}): Promise<CalResult<T>> {
  const token = await googleAuth.getAccessToken();
  if (!token) return { ok: false, error: 'Not authenticated with Google' };

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers as Record<string, string>),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `${res.status}: ${body}` };
    }

    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Public API ──

export const googleCalendar = {
  /** List events in a time range (default: today) */
  listEvents: async (
    timeMin?: string,
    timeMax?: string,
    maxResults = 50,
    calendarId = 'primary',
  ): Promise<CalResult<GoogleCalendarEvent[]>> => {
    const min = timeMin ?? dayjs().startOf('day').toISOString();
    const max = timeMax ?? dayjs().endOf('day').toISOString();
    const params = new URLSearchParams({
      timeMin: min,
      timeMax: max,
      maxResults: String(maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const result = await gCalFetch<{ items: GoogleCalendarEvent[] }>(
      `/calendars/${calendarId}/events?${params}`,
    );
    if (result.ok) return { ok: true, data: result.data.items ?? [] };
    return result as CalResult<GoogleCalendarEvent[]>;
  },

  /** Get a single event by ID */
  getEvent: async (
    eventId: string,
    calendarId = 'primary',
  ): Promise<CalResult<GoogleCalendarEvent>> => {
    return gCalFetch<GoogleCalendarEvent>(
      `/calendars/${calendarId}/events/${eventId}`,
    );
  },

  /** Create a new event */
  createEvent: async (
    event: CalendarEventInput,
    calendarId = 'primary',
  ): Promise<CalResult<GoogleCalendarEvent>> => {
    const body = {
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.startDateTime, timeZone: event.timeZone ?? 'UTC' },
      end: { dateTime: event.endDateTime, timeZone: event.timeZone ?? 'UTC' },
    };
    return gCalFetch<GoogleCalendarEvent>(
      `/calendars/${calendarId}/events`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /** Update an existing event (PATCH) */
  updateEvent: async (
    eventId: string,
    fields: Partial<CalendarEventInput>,
    calendarId = 'primary',
  ): Promise<CalResult<GoogleCalendarEvent>> => {
    const body: Record<string, unknown> = {};
    if (fields.summary !== undefined) body.summary = fields.summary;
    if (fields.description !== undefined) body.description = fields.description;
    if (fields.location !== undefined) body.location = fields.location;
    if (fields.startDateTime !== undefined) {
      body.start = { dateTime: fields.startDateTime, timeZone: fields.timeZone ?? 'UTC' };
    }
    if (fields.endDateTime !== undefined) {
      body.end = { dateTime: fields.endDateTime, timeZone: fields.timeZone ?? 'UTC' };
    }
    return gCalFetch<GoogleCalendarEvent>(
      `/calendars/${calendarId}/events/${eventId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },

  /** Delete an event */
  deleteEvent: async (
    eventId: string,
    calendarId = 'primary',
  ): Promise<CalResult<void>> => {
    return gCalFetch<void>(
      `/calendars/${calendarId}/events/${eventId}`,
      { method: 'DELETE' },
    );
  },
};
