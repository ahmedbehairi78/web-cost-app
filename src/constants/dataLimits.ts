/**
 * Upper bounds on real-time Firestore snapshots to keep sync time and RAM reasonable.
 * Reports using capped data may omit very old rows — enlarge if needed.
 */
export const LISTENER_PURCHASE_TX_CAP = 2_500;
/** GL row cap for Dashboard + Liquidity report KPI parity */
export const LISTENER_LIQUIDITY_KPI_GL_CAP = 5_000;
export const LISTENER_GL_TX_GENERAL_CAP = 8_000;
export const LISTENER_GL_TX_SCREEN_CAP = 4_500;
export const LISTENER_REPORTS_TRANSACTIONS_CAP = 10_000;
export const LISTENER_REPORTS_PURCHASE_CAP = 3_500;
export const LISTENER_REPORTS_ACTUAL_COSTS_CAP = 4_500;
export const LISTENER_PURCHASE_BOQ_CAP = 8_000;
