import { driver, DriveStep, Config } from 'driver.js';
import { TabId } from '../components/common/Tabs';
import { translations } from '../i18n/translations';

type TranslationType = typeof translations.vi;

const ONBOARDING_KEY = 'auto_read_pdf_onboarding_completed_v2';

export type TourActionType =
  | 'openColorConfig'
  | 'closeColorConfig'
  | 'openImageModal'
  | 'closeImageModal'
  | 'openVesselWatchlist'
  | 'closeVesselWatchlist'
  | 'openContainerWatchlist'
  | 'closeContainerWatchlist';

type TourEventListener = (action: TourActionType) => void;

const tourActionListeners = new Set<TourEventListener>();

export const subscribeTourActions = (listener: TourEventListener) => {
  tourActionListeners.add(listener);
  return () => {
    tourActionListeners.delete(listener);
  };
};

export const emitTourAction = (action: TourActionType) => {
  tourActionListeners.forEach((fn) => {
    try {
      fn(action);
    } catch (e) {
      console.error('Tour action error:', e);
    }
  });
};

export interface TourManagerOptions {
  t: TranslationType;
  onTabChange?: (tabId: TabId) => void;
}

/**
 * Creates and starts the comprehensive full app guided walkthrough
 */
export const startFullAppTour = ({ t, onTabChange }: TourManagerOptions) => {
  const steps: DriveStep[] = [
    // 1. Logo & App Overview
    {
      element: '[data-tour="brand"]',
      popover: {
        title: t.tour.steps.brand.title,
        description: t.tour.steps.brand.desc,
        side: 'bottom',
        align: 'start',
      },
    },
    // 2. Collection Selector & Manager
    {
      element: '[data-tour="collection-selector"]',
      popover: {
        title: t.tour.steps.collection.title,
        description: t.tour.steps.collection.desc,
        side: 'bottom',
        align: 'start',
      },
    },
    // 3. Auto-Sync Toggle
    {
      element: '[data-tour="auto-sync"]',
      popover: {
        title: t.tour.steps.autoSync.title,
        description: t.tour.steps.autoSync.desc,
        side: 'bottom',
        align: 'center',
      },
    },
    // 4. Color Rules Button
    {
      element: '[data-tour="color-rules"]',
      popover: {
        title: t.tour.steps.colorRules.title,
        description: t.tour.steps.colorRules.desc,
        side: 'bottom',
        align: 'center',
      },
      onHighlightStarted: () => {
        emitTourAction('openColorConfig');
      },
    },
    // 4a. Color Target Select (inside modal)
    {
      element: '[data-tour="color-target-select"]',
      popover: {
        title: t.tour.steps.colorTarget.title,
        description: t.tour.steps.colorTarget.desc,
        side: 'bottom',
        align: 'center',
      },
    },
    // 4b. Color Condition (inside modal)
    {
      element: '[data-tour="color-condition"]',
      popover: {
        title: t.tour.steps.colorCondition.title,
        description: t.tour.steps.colorCondition.desc,
        side: 'bottom',
        align: 'center',
      },
    },
    // 4c. Color Palette (inside modal)
    {
      element: '[data-tour="color-palette"]',
      popover: {
        title: t.tour.steps.colorPalette.title,
        description: t.tour.steps.colorPalette.desc,
        side: 'top',
        align: 'center',
      },
      onDeselected: () => {
        emitTourAction('closeColorConfig');
      },
    },
    // 5. Settings, AI Vision & Backup
    {
      element: '[data-tour="settings"]',
      popover: {
        title: t.tour.steps.settings.title,
        description: t.tour.steps.settings.desc,
        side: 'bottom',
        align: 'end',
      },
    },
    // 6. Navigation Tabs
    {
      element: '[data-tour="nav-tabs"]',
      popover: {
        title: t.tour.steps.navTabs.title,
        description: t.tour.steps.navTabs.desc,
        side: 'bottom',
        align: 'start',
      },
    },
    // 7. Dashboard Module
    {
      element: '[data-tour="tab-dashboard"]',
      popover: {
        title: t.tabs.dashboard,
        description: `${t.tour.steps.dashboardKPIs.desc} ${t.tour.steps.dashboardAlerts.desc}`,
        side: 'bottom',
        align: 'start',
      },
      onHighlightStarted: () => {
        if (onTabChange) onTabChange('dashboard');
      },
    },
    // 8. Booking Module
    {
      element: '[data-tour="tab-booking"]',
      popover: {
        title: t.tabs.booking,
        description: `${t.tour.steps.bookingDropzone.desc} ${t.tour.steps.bookingAiOCR.desc}`,
        side: 'bottom',
        align: 'start',
      },
      onHighlightStarted: () => {
        if (onTabChange) onTabChange('booking');
      },
    },
    // 9. Vessel Module
    {
      element: '[data-tour="tab-vessel"]',
      popover: {
        title: t.tabs.vessel,
        description: `${t.tour.steps.vesselQuery.desc} ${t.tour.steps.vesselWatchlistBtn.desc}`,
        side: 'bottom',
        align: 'start',
      },
      onHighlightStarted: () => {
        if (onTabChange) onTabChange('vessel');
      },
    },
    // 10. Container Module
    {
      element: '[data-tour="tab-container"]',
      popover: {
        title: t.tabs.container,
        description: `${t.tour.steps.containerQuery.desc} ${t.tour.steps.containerEventPills.desc}`,
        side: 'bottom',
        align: 'start',
      },
      onHighlightStarted: () => {
        if (onTabChange) onTabChange('container');
      },
    },
    // 11. Help & Tour Button
    {
      element: '[data-tour="help-tour"]',
      popover: {
        title: t.tour.steps.helpTour.title,
        description: t.tour.steps.helpTour.desc,
        side: 'bottom',
        align: 'end',
      },
    },
  ];

  const driverObj = driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayOpacity: 0.35,
    popoverClass: 'app-driver-popover',
    nextBtnText: t.tour.btnNext,
    prevBtnText: t.tour.btnPrev,
    doneBtnText: t.tour.btnDone,
    progressText: t.tour.progressText,
    steps,
    onDestroyStarted: () => {
      emitTourAction('closeColorConfig');
      emitTourAction('closeImageModal');
      emitTourAction('closeVesselWatchlist');
      emitTourAction('closeContainerWatchlist');
      localStorage.setItem(ONBOARDING_KEY, 'true');
      driverObj.destroy();
    },
  } as Config);

  driverObj.drive();
};

/**
 * Starts a contextual feature tour for the currently active tab
 */
export const startTabTour = (tabId: TabId, { t }: TourManagerOptions) => {
  let steps: DriveStep[] = [];

  if (tabId === 'dashboard') {
    steps = [
      {
        element: '[data-tour="dashboard-scope"]',
        popover: {
          title: t.tour.steps.dashboardScope.title,
          description: t.tour.steps.dashboardScope.desc,
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="dashboard-kpis"]',
        popover: {
          title: t.tour.steps.dashboardKPIs.title,
          description: t.tour.steps.dashboardKPIs.desc,
          side: 'bottom',
          align: 'center',
        },
      },
      {
        element: '[data-tour="dashboard-alerts"]',
        popover: {
          title: t.tour.steps.dashboardAlerts.title,
          description: t.tour.steps.dashboardAlerts.desc,
          side: 'top',
          align: 'center',
        },
      },
      {
        element: '[data-tour="dashboard-charts"]',
        popover: {
          title: t.tour.steps.dashboardCharts.title,
          description: t.tour.steps.dashboardCharts.desc,
          side: 'top',
          align: 'center',
        },
      },
    ];
  } else if (tabId === 'booking') {
    steps = [
      // 1. Dropzone
      {
        element: '[data-tour="booking-dropzone"]',
        popover: {
          title: t.tour.steps.bookingDropzone.title,
          description: t.tour.steps.bookingDropzone.desc,
          side: 'bottom',
          align: 'center',
        },
      },
      // 2. Search
      {
        element: '[data-tour="booking-search"]',
        popover: {
          title: t.tour.steps.bookingSearch.title,
          description: t.tour.steps.bookingSearch.desc,
          side: 'bottom',
          align: 'start',
        },
      },
      // 3. AI Vision OCR button
      {
        element: '[data-tour="booking-ai-ocr"]',
        popover: {
          title: t.tour.steps.bookingAiOCR.title,
          description: t.tour.steps.bookingAiOCR.desc,
          side: 'bottom',
          align: 'center',
        },
        onHighlightStarted: () => {
          emitTourAction('openImageModal');
        },
      },
      // 3a. OCR Controls & manipulation (inside modal)
      {
        element: '[data-tour="ocr-controls"]',
        popover: {
          title: t.tour.steps.ocrControls.title,
          description: t.tour.steps.ocrControls.desc,
          side: 'right',
          align: 'center',
        },
      },
      // 3b. OCR Dropzone & Paste (inside modal)
      {
        element: '[data-tour="ocr-dropzone"]',
        popover: {
          title: t.tour.steps.ocrDropzone.title,
          description: t.tour.steps.ocrDropzone.desc,
          side: 'right',
          align: 'center',
        },
      },
      // 3c. OCR 14 fields form (inside modal)
      {
        element: '[data-tour="ocr-fields"]',
        popover: {
          title: t.tour.steps.ocrFields.title,
          description: t.tour.steps.ocrFields.desc,
          side: 'left',
          align: 'center',
        },
        onDeselected: () => {
          emitTourAction('closeImageModal');
        },
      },
      // 4. Column Config
      {
        element: '[data-tour="booking-col-config"]',
        popover: {
          title: t.tour.steps.bookingColumns.title,
          description: t.tour.steps.bookingColumns.desc,
          side: 'bottom',
          align: 'center',
        },
      },
      // 5. Export Excel
      {
        element: '[data-tour="booking-export"]',
        popover: {
          title: t.tour.steps.bookingExport.title,
          description: t.tour.steps.bookingExport.desc,
          side: 'bottom',
          align: 'center',
        },
      },
      // 6. Main Table
      {
        element: '[data-tour="booking-table"]',
        popover: {
          title: t.tour.steps.bookingTable.title,
          description: t.tour.steps.bookingTable.desc,
          side: 'top',
          align: 'center',
        },
      },
    ];
  } else if (tabId === 'vessel') {
    steps = [
      // 1. Vessel Query Form
      {
        element: '[data-tour="vessel-query-form"]',
        popover: {
          title: t.tour.steps.vesselQuery.title,
          description: t.tour.steps.vesselQuery.desc,
          side: 'bottom',
          align: 'start',
        },
      },
      // 2. Vessel Watchlist Button
      {
        element: '[data-tour="vessel-watchlist-btn"]',
        popover: {
          title: t.tour.steps.vesselWatchlistBtn.title,
          description: t.tour.steps.vesselWatchlistBtn.desc,
          side: 'bottom',
          align: 'end',
        },
        onHighlightStarted: () => {
          emitTourAction('openVesselWatchlist');
        },
      },
      // 2a. Vessel Watchlist Form (inside modal)
      {
        element: '[data-tour="vessel-watchlist-form"]',
        popover: {
          title: t.tour.steps.vesselWatchlistForm.title,
          description: t.tour.steps.vesselWatchlistForm.desc,
          side: 'bottom',
          align: 'center',
        },
      },
      // 2b. Vessel Watchlist Sync & Table (inside modal)
      {
        element: '[data-tour="vessel-watchlist-sync"]',
        popover: {
          title: t.tour.steps.vesselWatchlistSync.title,
          description: t.tour.steps.vesselWatchlistSync.desc,
          side: 'top',
          align: 'center',
        },
        onDeselected: () => {
          emitTourAction('closeVesselWatchlist');
        },
      },
      // 3. Vessel Schedule Table
      {
        element: '[data-tour="vessel-table"]',
        popover: {
          title: t.tour.steps.vesselTable.title,
          description: t.tour.steps.vesselTable.desc,
          side: 'top',
          align: 'center',
        },
      },
    ];
  } else if (tabId === 'container') {
    steps = [
      // 1. Container Query Form
      {
        element: '[data-tour="container-query-form"]',
        popover: {
          title: t.tour.steps.containerQuery.title,
          description: t.tour.steps.containerQuery.desc,
          side: 'bottom',
          align: 'start',
        },
      },
      // 2. Container Watchlist Button
      {
        element: '[data-tour="container-watchlist-btn"]',
        popover: {
          title: t.tour.steps.containerWatchlistBtn.title,
          description: t.tour.steps.containerWatchlistBtn.desc,
          side: 'bottom',
          align: 'end',
        },
        onHighlightStarted: () => {
          emitTourAction('openContainerWatchlist');
        },
      },
      // 2a. Container Watchlist Form (inside modal)
      {
        element: '[data-tour="container-watchlist-form"]',
        popover: {
          title: t.tour.steps.containerWatchlistForm.title,
          description: t.tour.steps.containerWatchlistForm.desc,
          side: 'bottom',
          align: 'center',
        },
      },
      // 2b. Container Watchlist List & Sync (inside modal)
      {
        element: '[data-tour="container-watchlist-list"]',
        popover: {
          title: t.tour.steps.containerWatchlistList.title,
          description: t.tour.steps.containerWatchlistList.desc,
          side: 'top',
          align: 'center',
        },
        onDeselected: () => {
          emitTourAction('closeContainerWatchlist');
        },
      },
      // 3. Event Filter Pills
      {
        element: '[data-tour="container-event-pills"]',
        popover: {
          title: t.tour.steps.containerEventPills.title,
          description: t.tour.steps.containerEventPills.desc,
          side: 'bottom',
          align: 'start',
        },
      },
      // 4. Container Table
      {
        element: '[data-tour="container-table"]',
        popover: {
          title: t.tour.steps.containerTable.title,
          description: t.tour.steps.containerTable.desc,
          side: 'top',
          align: 'center',
        },
      },
    ];
  }

  if (steps.length === 0) return;

  const driverObj = driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayOpacity: 0.35,
    popoverClass: 'app-driver-popover',
    nextBtnText: t.tour.btnNext,
    prevBtnText: t.tour.btnPrev,
    doneBtnText: t.tour.btnDone,
    progressText: t.tour.progressText,
    steps,
    onDestroyStarted: () => {
      emitTourAction('closeColorConfig');
      emitTourAction('closeImageModal');
      emitTourAction('closeVesselWatchlist');
      emitTourAction('closeContainerWatchlist');
      driverObj.destroy();
    },
  } as Config);

  driverObj.drive();
};

/**
 * Checks if the user has completed onboarding before, returns boolean
 */
export const hasCompletedOnboarding = (): boolean => {
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
};

/**
 * Marks onboarding as completed or dismissed
 */
export const setOnboardingCompleted = (completed: boolean = true) => {
  localStorage.setItem(ONBOARDING_KEY, completed ? 'true' : 'false');
};

