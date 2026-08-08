export interface InventoryPrintRow {
  id: number;
  label: string;
  unit: string;
  quantityIn: number;
  quantityIssued: number;
  quantityReturned: number;
  quantityBalance: number;
  quantityReserved: number;
  quantityAvailable: number;
  unitCost: number;
  totalValue: number;
}

export interface InventoryWarehousePrintData {
  projectName: string;
  projectCode?: string;
  warehouseAccountLabel?: string;
  rows: InventoryPrintRow[];
  totalValue: number;
}
