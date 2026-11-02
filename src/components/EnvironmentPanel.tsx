import { type Inspection } from "../domain";
import { dailyReportDefaults } from "../daily-report";
import { Field } from "./ui";

/** Site weather, recorded by hand. Printed in the report after Location. */
export function EnvironmentPanel({
  record,
  onChange,
}: {
  record: Inspection;
  onChange: (record: Inspection) => void;
}) {
  const readOnly = record.status !== "Draft";
  const snapshot = record.weatherSnapshot;
  return (
    <section className="inspection-section" aria-label="Weather">
      <h2 className="section-label">Weather</h2>
      <div className="card environment-card">
        <Field label="Observed site weather">
          <input
            maxLength={500}
            disabled={readOnly}
            value={record.dailyReport?.weather || ""}
            placeholder="[e.g. Partly cloudy, 30 C]"
            onChange={(e) =>
              onChange({
                ...record,
                dailyReport: {
                  ...dailyReportDefaults(record),
                  weather: e.target.value,
                },
              })
            }
          />
        </Field>
        {snapshot && !record.dailyReport?.weather?.trim() && (
          <p className="small muted">
            Saved forecast from an earlier version of the app:{" "}
            {snapshot.summary}, {snapshot.temperatureC} C (MET Norway, CC BY
            4.0). It is used in the report until you record the observed
            weather.
          </p>
        )}
      </div>
    </section>
  );
}
