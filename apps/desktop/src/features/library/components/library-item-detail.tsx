import type { LibraryItemDto } from '@devdock/types';

interface LibraryItemDetailProps {
  item: LibraryItemDto | null;
}

function formatTimestamp(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '';
}

export function LibraryItemDetail({ item }: LibraryItemDetailProps): JSX.Element {
  if (!item) {
    return <aside className="dd-detail dd-detail--empty">Select an item to see its details.</aside>;
  }

  const body = item.body;

  return (
    <aside className="dd-detail">
      <header>
        <h3>{item.title}</h3>
        <p className="dd-detail__meta">
          <span className={`dd-kind dd-kind--${item.kind}`}>{item.kind}</span>
          {item.favorite && <span className="dd-tag dd-tag--favorite">★ Favorite</span>}
          {item.archived && <span className="dd-tag dd-tag--archived">Archived</span>}
        </p>
      </header>
      {item.description && <p className="dd-detail__description">{item.description}</p>}
      <dl className="dd-detail__stats">
        <dt>Kind</dt>
        <dd>{item.kind}</dd>
        {body?.type === 'script' && (
          <>
            <dt>Shell</dt>
            <dd>{body.shell}</dd>
          </>
        )}
        {body?.type === 'script' && body.workingDirectory && (
          <>
            <dt>Working dir</dt>
            <dd>{body.workingDirectory}</dd>
          </>
        )}
        {body?.type === 'note' && (
          <>
            <dt>Format</dt>
            <dd>{body.contentFormat === 'json' ? 'JSON' : body.contentFormat}</dd>
          </>
        )}
        <dt>Created</dt>
        <dd>{formatTimestamp(item.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(item.updatedAt)}</dd>
      </dl>
      {body && 'content' in body && (
        <pre className="dd-detail__content">
          <code>{body.content}</code>
        </pre>
      )}
    </aside>
  );
}
