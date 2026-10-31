import { newInspection, templates } from "./domain";
export const details = {
  projectId: "test-project",
  projectName: "Test Project",
  projectReference: "TEST-001",
  date: "2026-10-30",
  time: "09:30",
  type: "Sheet Pile",
  element: "SP-TEST",
  location: "Zone A",
  inspector: "Test Inspector",
  role: "TCP T3",
  drawing: "TEST-DWG-01",
  remarks: "Test observation",
};
export function fixture() {
  return newInspection(details, templates[0]);
}
