// Shared frame geometry. Keep this module independent of the page registry so
// page renderers can budget their content without importing the frame.
export const STRIP_SPLIT_COLS = 66

// X1: shared page numbering for the pane and the closed band's navigation.
export const PAGE_KEYS: Record<string, string> = { now: '1', decide: '2', fleet: '3', quota: '4', dispatch: '5', review: '6', spend: '7', hygiene: '8', pet: '9', forge: '0' }
