import 'driver.js/dist/driver.css';
import '../styles/driver-theme.css';
import { driver, Config, Driver, DriveStep, Side, Alignment } from 'driver.js';
import { TabId } from '../components/common/Tabs';
import { translations } from '../i18n/translations';
import { TourActionType, emitTourAction, setOnboardingCompleted } from './tourEvents';
export { subscribeTourActions, emitTourAction, hasCompletedOnboarding, hasTabTour, setOnboardingCompleted } from './tourEvents';
export type { TourActionType } from './tourEvents';

type TranslationType = typeof translations.vi;
type StepKey = keyof TranslationType['tour']['steps'];

export interface TourManagerOptions {
  t: TranslationType;
  onTabChange?: (tabId: TabId) => void;
}

/** One tour step: what to point at, its text, and the UI state it needs. */
interface TourStep {
  /** data-tour anchor; none = a centred popover */
  anchor?: string;
  text: StepKey;
  side?: Side;
  align?: Alignment;
  /** The tab it lives on (switched to first) */
  tab?: TabId;
  /** Tour actions that put the screen in the state this step shows */
  enter?: TourActionType[];
  /** Skipped when its anchor never shows up (e.g. no booking to open) */
  optional?: boolean;
}

const WAIT_MS = 2500;
const selector = (anchor: string) => `[data-tour="${anchor}"]`;

/** Resolves once the anchor is on screen (tabs and calendars load lazily), or false after WAIT_MS. */
const waitForAnchor = (anchor: string | undefined): Promise<boolean> => {
  if (!anchor) return Promise.resolve(true);
  const visible = () => {
    const el = document.querySelector<HTMLElement>(selector(anchor));
    return !!el && el.getClientRects().length > 0;
  };
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (visible()) resolve(true);
      else if (Date.now() - started > WAIT_MS) resolve(false);
      else setTimeout(tick, 80);
    };
    tick();
  });
};

// --- the steps --------------------------------------------------------------------------------------------
const bookingTable: TourActionType[] = ['showBookingTable', 'closeBookingDetail'];
const bookingCalendar: TourActionType[] = ['showBookingCalendar', 'closeBookingDetail'];

const BOOKING_STEPS: TourStep[] = [
  { anchor: 'view-toggle', text: 'bookingViewToggle', tab: 'booking', enter: bookingTable, side: 'bottom', align: 'start' },
  { anchor: 'calendar-week', text: 'bookingCalendar', tab: 'booking', enter: bookingCalendar, side: 'bottom', align: 'start' },
  { anchor: 'calendar-summary', text: 'bookingCalendarSummary', tab: 'booking', enter: bookingCalendar, side: 'bottom', align: 'end' },
  { anchor: 'calendar-filters', text: 'bookingCalendarFilters', tab: 'booking', enter: bookingCalendar, side: 'bottom', align: 'start', optional: true },
  { anchor: 'booking-hide-closed', text: 'bookingHideClosed', tab: 'booking', enter: bookingTable, side: 'bottom', align: 'start' },
  { anchor: 'booking-status-col', text: 'bookingStatus', tab: 'booking', enter: bookingTable, side: 'bottom', align: 'center', optional: true },
  { anchor: 'booking-cutoff-col', text: 'bookingCutoff', tab: 'booking', enter: bookingTable, side: 'bottom', align: 'center', optional: true },
  { anchor: 'booking-links', text: 'bookingLinks', tab: 'booking', enter: ['showBookingTable', 'openFirstBooking'], side: 'top', align: 'center', optional: true },
  { anchor: 'export', text: 'exportTemplates', tab: 'booking', enter: bookingTable, side: 'bottom', align: 'end' },
];

const VESSEL_STEPS: TourStep[] = [
  { anchor: 'view-toggle', text: 'vesselViewToggle', tab: 'vessel', enter: ['showVesselTable'], side: 'bottom', align: 'start' },
  { anchor: 'calendar-week', text: 'vesselCalendar', tab: 'vessel', enter: ['showVesselCalendar'], side: 'bottom', align: 'start' },
  { anchor: 'calendar-filters', text: 'vesselCalendarFilters', tab: 'vessel', enter: ['showVesselCalendar'], side: 'bottom', align: 'start', optional: true },
  { anchor: 'export', text: 'exportTemplates', tab: 'vessel', enter: ['showVesselTable'], side: 'bottom', align: 'end' },
];

const CONTAINER_STEPS: TourStep[] = [
  { anchor: 'export', text: 'exportTemplates', tab: 'container', side: 'bottom', align: 'end' },
];

const REMINDER_STEPS: TourStep[] = [
  { anchor: 'notifications', text: 'reminders', side: 'bottom', align: 'end' },
  { anchor: 'settings', text: 'reminderSettings', side: 'bottom', align: 'end' },
];

const FULL_TOUR: TourStep[] = [
  { text: 'welcome', tab: 'booking', enter: bookingTable },
  ...BOOKING_STEPS,
  ...VESSEL_STEPS,
  ...REMINDER_STEPS,
  { anchor: 'help-tour', text: 'helpTour', side: 'bottom', align: 'end' },
];

const TAB_TOURS: Partial<Record<TabId, TourStep[]>> = {
  booking: BOOKING_STEPS,
  vessel: VESSEL_STEPS,
  container: CONTAINER_STEPS,
  dashboard: REMINDER_STEPS,
};


// --- running a tour ---------------------------------------------------------------------------------------
/** driver.js leaves its highlight class on the previous element when a step's screen re-renders
 * (view / tab switches), so the old element keeps its ring: drop it before moving on. */
const clearStaleHighlight = () =>
  document.querySelectorAll('.driver-active-element').forEach((el) => el.classList.remove('driver-active-element'));

/** Switches tab / view for a step and waits for its anchor; false when an optional anchor never came. */
const prepare = async (step: TourStep, current: { tab?: TabId }, onTabChange?: (tab: TabId) => void): Promise<boolean> => {
  if (step.tab && step.tab !== current.tab && onTabChange) {
    emitTourAction('restoreViews'); // leave the tab as the user had it
    onTabChange(step.tab);
    current.tab = step.tab;
    await waitForAnchor('export'); // every tab with a tour has it; the tab has mounted
  }
  // a lazily mounted tab may miss the first actions: fire them again once it is there
  for (let i = 0; i < 2; i++) {
    step.enter?.forEach(emitTourAction);
    if (await waitForAnchor(step.anchor)) return true;
  }
  return !step.optional;
};

const runTour = async (tourSteps: TourStep[], { t, onTabChange }: TourManagerOptions, onFinish?: () => void) => {
  if (tourSteps.length === 0) return;
  let driverObj: Driver;
  let busy = false;
  const current: { tab?: TabId } = {};

  /** Moves from step `from` to the nearest step in `dir` whose screen is ready. */
  const go = async (from: number, dir: 1 | -1) => {
    if (busy) return;
    busy = true;
    try {
      for (let i = from + dir; i >= 0 && i < tourSteps.length; i += dir) {
        if (await prepare(tourSteps[i], current, onTabChange)) {
          clearStaleHighlight();
          driverObj.moveTo(i);
          return;
        }
      }
      if (dir === 1) driverObj.destroy();
    } finally {
      busy = false;
    }
  };

  const steps: DriveStep[] = tourSteps.map((s, i) => ({
    element: s.anchor ? selector(s.anchor) : undefined,
    popover: {
      title: t.tour.steps[s.text].title,
      description: t.tour.steps[s.text].desc,
      side: s.side,
      align: s.align,
      onNextClick: () => void go(i, 1),
      onPrevClick: () => void go(i, -1),
    },
  }));

  const config: Config = {
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayOpacity: 0.35,
    popoverClass: 'app-driver-popover',
    nextBtnText: t.tour.btnNext,
    prevBtnText: t.tour.btnPrev,
    doneBtnText: t.tour.btnDone,
    // driver.js fills {{current}} / {{total}}; the translations use {current} like the rest of the app
    progressText: t.tour.progressText.replace('{current}', '{{current}}').replace('{total}', '{{total}}'),
    steps,
    onDestroyStarted: () => {
      emitTourAction('restoreViews');
      onFinish?.();
      driverObj.destroy();
    },
  };
  driverObj = driver(config);

  // open on the first step whose screen is ready
  for (let i = 0; i < tourSteps.length; i++) {
    if (await prepare(tourSteps[i], current, onTabChange)) {
      driverObj.drive(i);
      return;
    }
  }
};

/** The new-features tour across the app (booking, vessel, reminders). */
export const startFullAppTour = (options: TourManagerOptions) =>
  runTour(FULL_TOUR, options, () => setOnboardingCompleted(true));

/** The new features of the tab the user is on. */
export const startTabTour = (tabId: TabId, options: TourManagerOptions) =>
  runTour((TAB_TOURS[tabId] || []).map(({ tab: _tab, ...s }) => s), options);
