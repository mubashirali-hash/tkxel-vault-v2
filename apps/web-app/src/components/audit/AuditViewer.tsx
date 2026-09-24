import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, FileClock, Search, ShieldCheck, X } from 'lucide-react';
import { AuditEvent } from '@tkxel-vault/types';
import { Badge, Button, Drawer, EmptyState, IconButton, PageHeader } from '../ui/index.js';

export interface AuditViewerProps {
  events: AuditEvent[];
  onExportCsv: () => void;
  knownNames?: Record<string, string>;
}

const PAGE_SIZE = 25;

const actionLabels: Record<string, string> = {
  create_vault: 'Created a vault', edit_vault: 'Updated vault settings', delete_vault: 'Deleted a vault', mode_change: 'Changed vault protection',
  share_vault: 'Shared vault access', revoke_vault: 'Revoked vault access', export_open_vault: 'Exported open vault', export_locked_denied: 'Blocked locked-vault export',
  create_page: 'Created a note', edit_page: 'Edited a note', publish_page: 'Published a note', publish_version: 'Published a version', save_draft: 'Saved a draft', unpublish_page: 'Returned a note to draft', delete_page: 'Deleted a note',
  upload_skill: 'Added a protected skill', publish_skill: 'Published a protected skill', delete_skill: 'Deleted a protected skill', tool_call: 'Used an integration tool',
  tool_denied: 'Blocked a tool request', security_alert: 'Raised a security alert',
};

export function describeAuditAction(action: string): string {
  return actionLabels[action] || action.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

export function auditOutcome(action: string): 'attention' | 'success' {
  return action.includes('denied') || action.includes('alert') ? 'attention' : 'success';
}

function relativeTime(timestamp: Date | string): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function summarizeMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata);
  if (!entries.length) return 'No additional details';
  return entries.slice(0, 2).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`).join(' · ');
}

function resolvedTargetName(event: AuditEvent, knownNames: Record<string, string>): string {
  const metadataTitle = typeof event.metadata.title === 'string' ? event.metadata.title : undefined;
  const skillName = typeof event.metadata.skill_name === 'string' ? event.metadata.skill_name : undefined;
  return knownNames[event.target_id] || metadataTitle || skillName || event.target_id;
}

export const AuditViewer: React.FC<AuditViewerProps> = ({ events, onExportCsv, knownNames = {} }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState('all');
  const [selectedActor, setSelectedActor] = useState('all');
  const [selectedOutcome, setSelectedOutcome] = useState('all');
  const [selectedDate, setSelectedDate] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  const actions = useMemo(() => Array.from(new Set(events.map((event) => event.action))).sort(), [events]);
  const actors = useMemo(() => Array.from(new Set(events.map((event) => event.actor_id))).sort(), [events]);
  const filtered = useMemo(() => events.filter((event) => {
    const query = searchQuery.toLowerCase();
    const actorName = knownNames[event.actor_id] || event.actor_id;
    const targetName = resolvedTargetName(event, knownNames);
    const matchesSearch = !query || actorName.toLowerCase().includes(query) || targetName.toLowerCase().includes(query) || describeAuditAction(event.action).toLowerCase().includes(query);
    const matchesAction = selectedAction === 'all' || event.action === selectedAction;
    const matchesActor = selectedActor === 'all' || event.actor_id === selectedActor;
    const matchesOutcome = selectedOutcome === 'all' || auditOutcome(event.action) === selectedOutcome;
    const ageDays = (Date.now() - new Date(event.timestamp).getTime()) / 86_400_000;
    const matchesDate = selectedDate === 'all' || ageDays <= Number(selectedDate);
    return matchesSearch && matchesAction && matchesActor && matchesOutcome && matchesDate;
  }), [events, knownNames, searchQuery, selectedAction, selectedActor, selectedOutcome, selectedDate]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleEvents = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [searchQuery, selectedAction, selectedActor, selectedOutcome, selectedDate]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  return (
    <main className="audit-viewer">
      <PageHeader
        title="Activity & Audit"
        description="Understand everyday activity, investigate blocked actions, and retain exact immutable event evidence."
        badge={<Badge tone="success" icon={<ShieldCheck size={13} />}>Tamper-proof</Badge>}
        actions={<Button variant="secondary" leadingIcon={<Download size={15} />} onClick={onExportCsv}>Export current vault CSV</Button>}
      />

      <section className="audit-filters" aria-label="Activity filters">
        <label className="audit-search"><Search size={15} /><input type="search" placeholder="Search people, activity, or resource…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
        <label><span>Person</span><select value={selectedActor} onChange={(event) => setSelectedActor(event.target.value)}><option value="all">Everyone</option>{actors.map((actor) => <option key={actor} value={actor}>{knownNames[actor] || actor}</option>)}</select></label>
        <label><span>Activity</span><select value={selectedAction} onChange={(event) => setSelectedAction(event.target.value)}><option value="all">All activity</option>{actions.map((action) => <option key={action} value={action}>{describeAuditAction(action)}</option>)}</select></label>
        <label><span>Outcome</span><select value={selectedOutcome} onChange={(event) => setSelectedOutcome(event.target.value)}><option value="all">All outcomes</option><option value="success">Completed</option><option value="attention">Needs attention</option></select></label>
        <label><span>Date</span><select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}><option value="all">Any time</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
      </section>

      <div className="audit-summary"><strong>{filtered.length}</strong> matching events <span>CSV export includes the authorized current-vault audit trail.</span></div>

      {visibleEvents.length ? (
        <section className="audit-list" aria-label="Activity events">
          {visibleEvents.map((event) => {
            const outcome = auditOutcome(event.action);
            const exactTime = new Date(event.timestamp).toISOString();
            return (
              <button type="button" className="audit-row" data-outcome={outcome} key={event.id} onClick={() => setSelectedEvent(event)}>
                <span className="audit-row__icon" aria-hidden="true">{outcome === 'attention' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}</span>
                <span className="audit-row__main"><strong>{describeAuditAction(event.action)}</strong><small>{knownNames[event.actor_id] || event.actor_id} · {summarizeMetadata(event.metadata)}</small></span>
                <span className="audit-row__target">{resolvedTargetName(event, knownNames)}</span>
                <time dateTime={exactTime} title={exactTime}>{relativeTime(event.timestamp)}</time>
              </button>
            );
          })}
        </section>
      ) : (
        <EmptyState icon={<FileClock size={24} />} title={events.length ? 'No matching activity' : 'No activity yet'} description={events.length ? 'Try clearing or broadening the filters.' : 'Actions in this vault will appear here as immutable audit events.'} />
      )}

      {filtered.length > PAGE_SIZE && (
        <nav className="audit-pagination" aria-label="Activity pages">
          <IconButton label="Previous activity page" icon={<ChevronLeft size={18} />} disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} />
          <span>Page {page} of {pageCount}</span>
          <IconButton label="Next activity page" icon={<ChevronRight size={18} />} disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} />
        </nav>
      )}

      <Drawer open={Boolean(selectedEvent)} label="Technical audit event details" onClose={() => setSelectedEvent(null)} className="audit-details">
        {selectedEvent && <>
          <header><div><span>Immutable event</span><h2>{describeAuditAction(selectedEvent.action)}</h2></div><IconButton label="Close event details" icon={<X size={18} />} onClick={() => setSelectedEvent(null)} /></header>
          <dl>
            <div><dt>Event ID</dt><dd>{selectedEvent.id}</dd></div>
            <div><dt>Exact UTC time</dt><dd>{new Date(selectedEvent.timestamp).toISOString()}</dd></div>
            <div><dt>Actor ID</dt><dd>{selectedEvent.actor_id}</dd></div>
            <div><dt>Action code</dt><dd>{selectedEvent.action}</dd></div>
            <div><dt>Target ID</dt><dd>{selectedEvent.target_id}</dd></div>
          </dl>
          <section><h3>Original metadata</h3><pre>{JSON.stringify(selectedEvent.metadata, null, 2)}</pre></section>
          <p className="audit-details__notice"><ShieldCheck size={15} />This view is read-only. The underlying event is append-only.</p>
        </>}
      </Drawer>
    </main>
  );
};
