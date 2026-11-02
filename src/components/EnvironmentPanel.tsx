import { useEffect, useRef, useState } from "react";
import { type Inspection, errorMessage, localDate } from "../domain";
import { dailyReportDefaults } from "../daily-report";
import {
  detectLocation,
  fetchWeather,
  gpsText,
  weatherText,
} from "../environment";
import { Button, Field } from "./ui";

export function EnvironmentPanel({
  record,
  onChange,
}: {
  record: Inspection;
  onChange: (record: Inspection) => void;
}) {
  const latest = useRef(record);
  latest.current = record;
  const alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const readOnly = record.status !== "Draft";
  async function job(kind: "gps" | "weather") {
    const id = record.id;
    setBusy(true);
    setMessage("");
    try {
      if (kind === "weather" && (!consent || !record.gps)) return;
      const result =
        kind === "gps"
          ? await detectLocation()
          : await fetchWeather(record.gps!);
      if (
        !alive.current ||
        latest.current.id !== id ||
        latest.current.status !== "Draft"
      )
        return;
      if ("latitude" in result) {
        onChange({
          ...latest.current,
          gps: result,
          weatherSnapshot: undefined,
        });
        setConsent(false);
        setMessage(
          "GPS acquired. Previous forecast cleared; location / chainage unchanged.",
        );
      } else {
        onChange({ ...latest.current, weatherSnapshot: result.weather });
        setMessage(
          result.cached
            ? "Saved forecast reused from device cache. Check its valid and retrieval times."
            : "Forecast snapshot saved. Confirm actual site conditions separately.",
        );
      }
    } catch (error) {
      if (alive.current && latest.current.id === id)
        setMessage(errorMessage(error));
    } finally {
      if (alive.current && latest.current.id === id) setBusy(false);
    }
  }
  return (
    <section
      className="inspection-section environment-panel"
      aria-label="Location and weather"
    >
      <h2 className="section-label">Location & weather</h2>
      <div className="card settings-body">
        <p className="small muted">
          GPS is acquired only when requested. It does not replace location /
          chainage. No background tracking.
        </p>
        <p className="small environment-text">{gpsText(record.gps)}</p>
        {!readOnly && (
          <div className="row wrap">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void job("gps")}
            >
              Get location
            </Button>
            {record.gps && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  onChange({
                    ...record,
                    gps: undefined,
                    weatherSnapshot: undefined,
                  });
                  setConsent(false);
                  setMessage("GPS and forecast cleared.");
                }}
              >
                Clear GPS & forecast
              </Button>
            )}
          </div>
        )}
        <p className="small environment-text">
          {weatherText(record.weatherSnapshot)}
        </p>
        {record.weatherSnapshot && (
          <p className="notice">
            Saved forecast snapshot, not live weather or an on-site measurement.
            Check the valid time against this inspection ({record.date}{" "}
            {record.time}). It is never refreshed automatically.
          </p>
        )}
        {!readOnly && (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={consent}
                disabled={!record.gps || busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Allow sending GPS coordinates (up to 4 decimal places) to MET
              Norway (api.met.no) for this weather request. The provider also
              receives your IP address. No inspection details or photos are
              sent.
            </label>
            <div className="row wrap">
              <Button
                variant="outline"
                disabled={
                  !record.gps || !consent || busy || record.date !== localDate()
                }
                onClick={() => void job("weather")}
              >
                Fetch weather forecast
              </Button>
              {record.weatherSnapshot && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    onChange({ ...record, weatherSnapshot: undefined })
                  }
                >
                  Clear forecast
                </Button>
              )}
            </div>
            {record.date !== localDate() && (
              <p className="small muted">
                Live retrieval is available for today's inspections only. For
                other dates, record actual conditions manually; this API does
                not supply historical observations.
              </p>
            )}
          </>
        )}
        {busy && (
          <p role="status">Request in progress… You can continue working.</p>
        )}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        <Field label="Observed site weather (manual)">
          <textarea
            rows={3}
            maxLength={10000}
            disabled={readOnly}
            value={record.dailyReport?.weather || ""}
            placeholder="Your actual site observations; separate from the model forecast."
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
        <p className="small muted">
          <a
            href="https://api.met.no/doc/TermsOfService"
            target="_blank"
            rel="noreferrer"
          >
            MET Norway API terms
          </a>{" "}
          ·{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>
          . Weather is optional; manual recording and reports work offline.
        </p>
      </div>
    </section>
  );
}
