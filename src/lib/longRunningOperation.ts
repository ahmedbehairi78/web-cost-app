/** Suppress idle lock while imports / backup / other long UI jobs run. */

let longRunningOperationDepth = 0;

export function beginLongRunningOperation(): void {
  longRunningOperationDepth += 1;
}

export function endLongRunningOperation(): void {
  longRunningOperationDepth = Math.max(0, longRunningOperationDepth - 1);
}

export function isLongRunningOperationActive(): boolean {
  return longRunningOperationDepth > 0;
}
