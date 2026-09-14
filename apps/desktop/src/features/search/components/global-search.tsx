// Global search box — invokes `search_library` via TanStack Query.

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebounce } from '@devdock/hooks';
import { useSearch } from '../../library/hooks/use-library';

export function GlobalSearch(): JSX.Element {
  const [value, setValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const navigate = useNavigate();
  const debounced = useDebounce(value, 200);
  const query = useSearch(debounced);

  const hits = query.data?.items ?? [];
  const visibleHits = hits.slice(0, 5);

  useEffect(() => setActiveIndex(-1), [debounced]);

  const openHit = (itemId: string): void => {
    setValue('');
    setActiveIndex(-1);
    navigate(`/library?item=${encodeURIComponent(itemId)}`);
  };

  return (
    <div className="dd-global-search">
      <Search className="dd-global-search__icon" size={16} aria-hidden="true" />
      <input
        type="search"
        placeholder="Search scripts and notes…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (!debounced || visibleHits.length === 0) {
            if (event.key === 'Escape') setValue('');
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % visibleHits.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => (current <= 0 ? visibleHits.length - 1 : current - 1));
          } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            openHit(visibleHits[activeIndex]!.itemId);
          } else if (event.key === 'Escape') {
            setValue('');
          }
        }}
        aria-label="Global search"
        aria-expanded={Boolean(debounced)}
        aria-controls="dd-global-search-results"
      />
      {debounced && (
        <div className="dd-global-search__results" id="dd-global-search-results">
          {query.isPending && <small>Searching…</small>}
          {query.isError && <small className="dd-banner dd-banner--error">Search failed</small>}
          {query.data && (
            <small className="dd-global-search__summary">
              {query.data.total} result{query.data.total === 1 ? '' : 's'}
            </small>
          )}
          {query.data && hits.length === 0 && (
            <p className="dd-global-search__empty">No scripts or notes match “{debounced}”.</p>
          )}
          {hits.length > 0 && (
            <ul>
              {visibleHits.map((hit, index) => (
                <li key={hit.itemId}>
                  <button
                    type="button"
                    className={index === activeIndex ? 'is-active' : ''}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => openHit(hit.itemId)}
                    title={hit.snippet}
                  >
                    <Search size={13} />
                    <span>
                      {hit.snippet.trim().split(/\r?\n/u)[0]?.slice(0, 96) || 'Untitled result'}
                    </span>
                    <code>{hit.itemId.slice(0, 8)}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
