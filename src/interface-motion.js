import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';

const PAGE_SELECTOR = [
  '.workspace > .ledger-page',
  '.workspace > .planner-page',
  '.workspace > .health-dashboard',
  '.workspace > .mine-home',
  '.workspace > .preferences-page',
  '.workspace > .system-messages',
].join(', ');

export function useAppMotion(scope, { page, mineView, ledgerView, assistantOpen, messageKey }) {
  const prior = useRef({ page, mineView, ledgerView, assistantOpen, messageKey });
  useGSAP(() => {
    const root = scope.current;
    if (!root) return undefined;

    const previous = prior.current;
    const pageChanged = page !== previous.page;
    const mineViewChanged = page === 'mine' && mineView !== previous.mineView;
    const ledgerViewChanged = page === 'ledger' && ledgerView !== previous.ledgerView;
    const assistantChanged = assistantOpen !== previous.assistantOpen;
    const newMessage = assistantOpen && previous.assistantOpen
      && messageKey && messageKey !== previous.messageKey;
    prior.current = { page, mineView, ledgerView, assistantOpen, messageKey };
    if (!pageChanged && !mineViewChanged && !ledgerViewChanged && !assistantChanged && !newMessage) return undefined;

    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const workspace = root.querySelector('.workspace');
      if (!workspace) return;

      if (assistantOpen) {
        const panel = workspace.querySelector('.assistant-panel');
        if (!panel) return;

        if (newMessage) {
          const messages = panel.querySelectorAll('[data-message-id]');
          const lastMessage = messages[messages.length - 1];
          if (lastMessage) gsap.fromTo(lastMessage, { autoAlpha: 0, y: 7 }, {
            autoAlpha: 1,
            y: 0,
            duration: .22,
            ease: 'power1.out',
            clearProps: 'opacity,visibility,transform',
          });
          return;
        }

        const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } });
        const heading = panel.querySelector('.chat-heading');
        const welcome = panel.querySelectorAll('.chat-welcome > *');
        const messages = [...panel.querySelectorAll('.message')].slice(-4);
        const composer = panel.querySelector('.composer');

        if (heading) timeline.fromTo(heading, { autoAlpha: 0, y: 8 }, {
          autoAlpha: 1, y: 0, duration: .24, clearProps: 'opacity,visibility,transform',
        });
        if (welcome.length) timeline.fromTo(welcome, { autoAlpha: 0, y: 7 }, {
          autoAlpha: 1, y: 0, duration: .24, stagger: .035,
          clearProps: 'opacity,visibility,transform',
        }, '<.06');
        if (messages.length) timeline.fromTo(messages, { autoAlpha: 0, y: 6 }, {
          autoAlpha: 1, y: 0, duration: .22, stagger: .035,
          clearProps: 'opacity,visibility,transform',
        }, '<.06');
        if (composer) timeline.fromTo(composer, { autoAlpha: 0, y: 6 }, {
          autoAlpha: 1, y: 0, duration: .22, clearProps: 'opacity,visibility,transform',
        }, '<.06');
        return;
      }

      const pageRoot = workspace.querySelector(PAGE_SELECTOR);
      if (!pageRoot) return;

      gsap.fromTo(pageRoot, { autoAlpha: 0, y: 8 }, {
        autoAlpha: 1,
        y: 0,
        duration: .3,
        ease: 'power2.out',
        clearProps: 'opacity,visibility,transform',
      });

      const items = [...pageRoot.querySelectorAll(
        '.ledger-row, .planner-task, .health-tile, .mine-menu-row',
      )].slice(0, 10);
      if (items.length) {
        gsap.fromTo(items, { autoAlpha: 0, y: 7 }, {
          autoAlpha: 1,
          y: 0,
          duration: .24,
          stagger: { amount: .18 },
          ease: 'power1.out',
          clearProps: 'opacity,visibility,transform',
          delay: .05,
        });
      }

      const activeIcons = root.querySelectorAll(
        '.sidebar nav button[aria-current="page"] svg, .mobile-nav > button[aria-current="page"] svg',
      );
      if (activeIcons.length) {
        gsap.fromTo(activeIcons, { scale: .82, rotate: -8 }, {
          scale: 1,
          rotate: 0,
          duration: .28,
          ease: 'back.out(2)',
          clearProps: 'transform',
        });
      }
    });

    return () => media.revert();
  }, {
    scope,
    dependencies: [page, mineView, ledgerView, assistantOpen, messageKey],
    revertOnUpdate: true,
  });
}
