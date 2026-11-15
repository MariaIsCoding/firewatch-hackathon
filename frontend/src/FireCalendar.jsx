
import { useEffect, useMemo, useState } from 'react'

const monthNames = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
]

const satelliteOptions = [
  { value: 'BOTH', label: 'Both (MODIS + VIIRS)' },
  { value: 'MODIS', label: 'MODIS only' },
  { value: 'VIIRS', label: 'VIIRS only' }
]

function FireCalendar() {
  const [year, setYear] = useState(2025)
  const [month, setMonth] = useState(0)
  const [sensor, setSensor] = useState('BOTH')
  const [selectedDay, setSelectedDay] = useState(null)

  const [dailyData, setDailyData] = useState([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch('/data/firewatch_daily.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Historical dataset unavailable')
        }
        return response.json()
      })
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error('Invalid historical dataset')
        }

        if (!cancelled) {
          setDailyData(data)
          setDataError(false)
        }
      })
      .catch((error) => {
        console.error('FireWatch calendar:', error)

        if (!cancelled) {
          setDataError(true)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDataLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const dailyLookup = useMemo(() => {
    const lookup = new Map()

    dailyData.forEach((item) => {
      if (
        (item.sensor === 'MODIS' || item.sensor === 'VIIRS') &&
        typeof item.date === 'string' &&
        Number.isFinite(item.activity_count) &&
        item.activity_count >= 0
      ) {
        lookup.set(
          `${item.sensor}-${item.date}`,
          item.activity_count
        )
      }
    })

    return lookup
  }, [dailyData])

  const availableYears = useMemo(() => {
    return [...new Set(
      dailyData.map((item) => Number(item.date?.slice(0, 4)))
    )]
      .filter(Number.isInteger)
      .sort((a, b) => a - b)
  }, [dailyData])

  function formatDate(day) {
    return [
      year,
      String(month + 1).padStart(2, '0'),
      String(day).padStart(2, '0')
    ].join('-')
  }

  function getCounts(day) {
    const date = formatDate(day)

    const modis = dailyLookup.get(`MODIS-${date}`) ?? null
    const viirs = dailyLookup.get(`VIIRS-${date}`) ?? null

    return {
      modis,
      viirs,
      total:
        modis !== null && viirs !== null
          ? modis + viirs
          : null
    }
  }

  function getDailyCount(day) {
    const counts = getCounts(day)

    if (sensor === 'MODIS') return counts.modis
    if (sensor === 'VIIRS') return counts.viirs

    return counts.total
  }

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const days = [
    ...Array(firstDay).fill(null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => index + 1
    )
  ]

  const monthlyCounts = Array.from(
    { length: daysInMonth },
    (_, index) => getDailyCount(index + 1)
  ).filter((count) => count !== null)

  const maxCount = Math.max(0, ...monthlyCounts)

  // ================================================
  // MONTHLY HISTORICAL ACTIVITY STATISTICS
  // ================================================

  function getMonthlyStatistics(targetYear, targetMonth) {
    const numberOfDays = new Date(
      targetYear,
      targetMonth + 1,
      0
    ).getDate()

    const today = new Date()
    const todayKey = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')
    ].join('-')

    let total = 0
    let recordedDays = 0
    let missingDays = 0
    let futureDays = 0

    for (let day = 1; day <= numberOfDays; day++) {
      const date = [
        targetYear,
        String(targetMonth + 1).padStart(2, '0'),
        String(day).padStart(2, '0')
      ].join('-')

      if (date > todayKey) {
        futureDays++
        continue
      }

      const modis = dailyLookup.get(`MODIS-${date}`) ?? null
      const viirs = dailyLookup.get(`VIIRS-${date}`) ?? null

      let count = null

      if (sensor === 'MODIS') {
        count = modis
      } else if (sensor === 'VIIRS') {
        count = viirs
      } else if (modis !== null && viirs !== null) {
        count = modis + viirs
      }

      if (count === null) {
        missingDays++
      } else {
        total += count
        recordedDays++
      }
    }

    const complete =
      recordedDays === numberOfDays &&
      missingDays === 0 &&
      futureDays === 0

    return {
      total,
      dailyAverage:
        recordedDays > 0 ? total / recordedDays : null,
      recordedDays,
      missingDays,
      futureDays,
      numberOfDays,
      complete
    }
  }

  const currentMonthStats = getMonthlyStatistics(year, month)

  const previousMonthDate = new Date(year, month - 1, 1)

  const previousMonthStats = getMonthlyStatistics(
    previousMonthDate.getFullYear(),
    previousMonthDate.getMonth()
  )

  const canCompareMonths =
    currentMonthStats.complete &&
    previousMonthStats.complete

  let previousMonthChange = null
  let previousMonthMessage = ''

  if (canCompareMonths) {
    if (previousMonthStats.total === 0) {
      previousMonthMessage =
        currentMonthStats.total === 0
          ? 'No change (both months recorded zero observations)'
          : 'Percentage unavailable (previous month was zero)'
    } else {
      previousMonthChange =
        ((currentMonthStats.total - previousMonthStats.total) /
          previousMonthStats.total) * 100
    }
  }

  function formatMonthlyNumber(value) {
    return value === null
      ? 'Unavailable'
      : value.toLocaleString('en-US', {
          maximumFractionDigits: 1
        })
  }

  function getDayColor(day) {
    if (day === null) return undefined

    const count = getDailyCount(day)

    if (count === null) return undefined
    if (maxCount === 0) return '#334155'

    const intensity = count / maxCount

    if (intensity < 0.2) return '#334155'
    if (intensity < 0.4) return '#78350f'
    if (intensity < 0.6) return '#9a3412'
    if (intensity < 0.8) return '#c2410c'

    return '#ea580c'
  }

  function changeMonth(direction) {
    const nextDate = new Date(year, month + direction, 1)
    const nextYear = nextDate.getFullYear()

    if (
      availableYears.length > 0 &&
      !availableYears.includes(nextYear)
    ) {
      return
    }

    setYear(nextYear)
    setMonth(nextDate.getMonth())
    setSelectedDay(null)
  }

  const canGoPrevious =
    availableYears.length > 0 &&
    new Date(year, month - 1, 1).getFullYear() >=
      availableYears[0]

  const canGoNext =
    availableYears.length > 0 &&
    new Date(year, month + 1, 1).getFullYear() <=
      availableYears[availableYears.length - 1]

  const selectedCounts =
    selectedDay !== null ? getCounts(selectedDay) : null

  function displayCount(count) {
    return count === null
      ? 'No record available'
      : count.toLocaleString()
  }

  return (
    <section className="fire-calendar">
      <h2>📅 Fire Activity Calendar</h2>

      <p>
        Explore historical NASA satellite hotspot observations
        by year, month, and satellite. A hotspot is a location
        where a satellite detected unusual heat that may be
        associated with fire. Multiple observations can come
        from the same wildfire, so these counts do not represent
        the number of separate wildfires.
      </p>

      <div className="calendar-controls">
        <label>
          Year:{' '}
          <select
            value={year}
            disabled={dataLoading || dataError}
            onChange={(event) => {
              setYear(Number(event.target.value))
              setSelectedDay(null)
            }}
          >
            {availableYears.length === 0 && (
              <option value={year}>{year}</option>
            )}

            {availableYears.map((availableYear) => (
              <option
                key={availableYear}
                value={availableYear}
              >
                {availableYear}
              </option>
            ))}
          </select>
        </label>

        <label>
          Month:{' '}
          <select
            value={month}
            onChange={(event) => {
              setMonth(Number(event.target.value))
              setSelectedDay(null)
            }}
          >
            {monthNames.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Satellite:{' '}
          <select
            value={sensor}
            onChange={(event) => {
              setSensor(event.target.value)
              setSelectedDay(null)
            }}
          >
            {satelliteOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="calendar-disclaimer">
        <strong>About combined observations:</strong> Selecting
        "Both" adds the MODIS and VIIRS hotspot detection counts
        for each day. A combined total is shown only when both
        satellites have data available. If either record is
        missing, the combined count is unavailable.
      </p>

      <div className="calendar-header">
        <button
          type="button"
          disabled={!canGoPrevious}
          onClick={() => changeMonth(-1)}
        >
          ◀ Previous
        </button>

        <h3>{monthNames[month]} {year}</h3>

        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => changeMonth(1)}
        >
          Next ▶
        </button>
      </div>

      {dataLoading && (
        <p>Loading historical satellite observations...</p>
      )}

      {dataError && (
        <p>
          Historical detection data could not be loaded.
          Please check the FireWatch daily JSON file.
        </p>
      )}

      <div className="calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
          (day) => (
            <div key={day} className="calendar-weekday">
              {day}
            </div>
          )
        )}

        {days.map((day, index) => {
          const count =
            day !== null ? getDailyCount(day) : null

          const isMissing =
            day !== null && count === null

          return (
            <button
              type="button"
              key={index}
              style={{
                backgroundColor: getDayColor(day)
              }}
              className={[
                'calendar-day',
                day === selectedDay ? 'selected' : '',
                isMissing ? 'missing-data' : ''
              ].filter(Boolean).join(' ')}
              disabled={
                day === null || dataLoading || dataError
              }
              onClick={() => setSelectedDay(day)}
              title={
                day === null
                  ? ''
                  : isMissing
                    ? 'Complete observation count unavailable'
                    : `${count.toLocaleString()} satellite observations`
              }
            >
              {day}
              {isMissing && (
                <span className="missing-indicator">—</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="calendar-legend">
        <p className="calendar-missing-note">
          <span className="missing-legend-symbol">—</span>
          {' '}No complete detection record available
        </p>

        <span>Lower daily activity</span>

        <div className="legend-colors">
          <span style={{ background: '#334155' }} />
          <span style={{ background: '#78350f' }} />
          <span style={{ background: '#9a3412' }} />
          <span style={{ background: '#c2410c' }} />
          <span style={{ background: '#ea580c' }} />
        </div>

        <span>Higher daily activity</span>
      </div>

      <p className="calendar-disclaimer">
        Colors compare hotspot observation counts within
        the selected month and satellite category.
        Brighter orange indicates higher relative activity.
        A dashed day indicates missing or incomplete data,
        not necessarily zero fires. Combined counts require
        records from both MODIS and VIIRS and are sums of
        observations, not unique wildfire counts.
      </p>

      {/* SELECTED DAY DETAILS */}
      {selectedDay !== null && selectedCounts && (
        <div className="calendar-details">
          <h3>
            {monthNames[month]} {selectedDay}, {year}
          </h3>

          <p>
            <strong>Satellite selection:</strong>{' '}
            {satelliteOptions.find(
              (option) => option.value === sensor
            )?.label}
          </p>

          {sensor === 'BOTH' ? (
            <>
              <p>
                MODIS observations:{' '}
                <strong>
                  {displayCount(selectedCounts.modis)}
                </strong>
              </p>

              <p>
                VIIRS observations:{' '}
                <strong>
                  {displayCount(selectedCounts.viirs)}
                </strong>
              </p>

              <p>
                Combined observations:{' '}
                <strong>
                  {displayCount(selectedCounts.total)}
                </strong>
              </p>
            </>
          ) : (
            <p>
              Satellite hotspot observations:{' '}
              <strong>
                {displayCount(getDailyCount(selectedDay))}
              </strong>
            </p>
          )}

          {getDailyCount(selectedDay) === null && (
            <p>
              A complete observation count is unavailable
              for this date and satellite selection.
            </p>
          )}
        </div>
      )}

      {/* MONTHLY ACTIVITY SUMMARY */}
      {!dataLoading && !dataError && (
        <div
          className="calendar-monthly-summary"
          style={{
            marginTop: '24px',
            padding: '20px',
            border: '1px solid #475569',
            borderRadius: '12px'
          }}
        >
          <h3>📊 Monthly Activity Summary</h3>

          <p
            style={{
              color: '#cbd5e1',
              fontSize: '14px',
              lineHeight: '1.6',
              marginTop: '8px',
              marginBottom: '18px'
            }}
          >
            This summary shows satellite hotspot observations
            across the selected month, rather than a single day.
            Monthly statistics are calculated from days with
            available records. If some days are missing, the
            totals are labeled as partial, and the data coverage
            is shown below.
          </p>

          <p>
            {monthNames[month]} {year} —{' '}
            {satelliteOptions.find(
              (option) => option.value === sensor
            )?.label}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '16px',
              marginTop: '18px'
            }}
          >
            <div>
              <p style={{ color: '#94a3b8' }}>
                {currentMonthStats.complete
                  ? 'Monthly Observations'
                  : 'Recorded Observations (Partial)'}
              </p>
              <h3>
                {formatMonthlyNumber(currentMonthStats.total)}
              </h3>
            </div>

            <div>
              <p style={{ color: '#94a3b8' }}>
                {currentMonthStats.complete
                  ? 'Daily Average'
                  : 'Average per Recorded Day'}
              </p>
              <h3>
                {formatMonthlyNumber(
                  currentMonthStats.dailyAverage
                )}
              </h3>
            </div>

            <div>
              <p style={{ color: '#94a3b8' }}>
                Vs. Previous Month
              </p>
              <h3>
                {!canCompareMonths
                  ? 'Unavailable'
                  : previousMonthChange !== null
                    ? `${previousMonthChange > 0 ? '+' : ''}${previousMonthChange.toFixed(1)}%`
                    : 'N/A'}
              </h3>
            </div>

            <div>
              <p style={{ color: '#94a3b8' }}>
                Data Coverage
              </p>
              <h3>
                {currentMonthStats.recordedDays}/
                {currentMonthStats.numberOfDays} days
              </h3>
              <p style={{ fontSize: '13px', color: '#94a3b8' }}>
                {(
                  (currentMonthStats.recordedDays /
                    currentMonthStats.numberOfDays) * 100
                ).toFixed(1)}% recorded
              </p>
            </div>
          </div>

          <p
            style={{
              marginTop: '18px',
              color: currentMonthStats.complete
                ? '#86efac'
                : '#fbbf24'
            }}
          >
            {currentMonthStats.complete
              ? `✓ Complete coverage: ${currentMonthStats.recordedDays} of ${currentMonthStats.numberOfDays} days recorded.`
              : `⚠️ Incomplete coverage: ${currentMonthStats.recordedDays} of ${currentMonthStats.numberOfDays} days recorded.`}
          </p>

          {!currentMonthStats.complete && (
            <p style={{ fontSize: '14px' }}>
              {currentMonthStats.missingDays > 0 && (
                <>
                  Missing observation records:{' '}
                  {currentMonthStats.missingDays}.
                  {' '}
                </>
              )}

              {currentMonthStats.futureDays > 0 && (
                <>
                  Future dates:{' '}
                  {currentMonthStats.futureDays}.
                </>
              )}

              {' '}The displayed total includes recorded days only.
              Missing dates are not treated as zero observations.
              The full-month comparison remains unavailable.
            </p>
          )}

          {currentMonthStats.complete &&
            !previousMonthStats.complete && (
              <p style={{ fontSize: '14px' }}>
                Previous-month comparison is unavailable
                because the previous month has incomplete
                coverage or falls outside the dataset.
              </p>
            )}

          {previousMonthMessage && (
            <p style={{ fontSize: '14px' }}>
              {previousMonthMessage}
            </p>
          )}

          <p
            style={{
              marginTop: '14px',
              fontSize: '13px',
              color: '#94a3b8'
            }}
          >
            Statistics represent satellite hotspot
            observations, not distinct wildfires.
            Previous-month comparisons use the same
            satellite selection and require complete
            daily records for both months.
          </p>
        </div>
      )}
    </section>
  )
}

export default FireCalendar
