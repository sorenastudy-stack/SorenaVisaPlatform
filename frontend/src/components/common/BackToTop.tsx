'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';

const SHOW_AFTER_PX = 300;

/**
 * Floating "back to top" button. Renders bottom-right, appears after the
 * user scrolls past 300px in the page's scroll container, and smooth-scrolls
 * it back to top on click.
 *
 * PortalLayout puts content inside a `<main>` element with overflow-y-auto
 * — window.scrollY never changes there. By default this component watches
 * the nearest `<main>` element. Layouts that scroll the window (or use a
 * different container) can pass a CSS selector.
 *
 * The button is always mounted (so the scroll listener can attach to the
 * container at mount) but visually hidden via opacity/pointer-events when
 * scroll position is at the top.
 */
export function BackToTop({
  scrollContainerSelector = 'main',
}: {
  scrollContainerSelector?: string;
}) {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(scrollContainerSelector);
    containerRef.current = el;
    if (!el) return;

    const onScroll = () => setVisible(el.scrollTop > SHOW_AFTER_PX);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollContainerSelector]);

  const onClick = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const hiddenClass = visible ? 'opacity-100' : 'pointer-events-none opacity-0';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-hidden={!visible}
      aria-label={t('commonBackToTop')}
      title={t('commonBackToTop')}
      className={[
        'fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full',
        'border border-sorena-navy/10 bg-sorena-navy text-white shadow-lg',
        'transition-opacity duration-150 hover:bg-sorena-navy/90',
        'focus:outline-none focus:ring-2 focus:ring-sorena-gold focus:ring-offset-2',
        hiddenClass,
      ].join(' ')}
    >
      <ArrowUp size={18} />
    </button>
  );
}
