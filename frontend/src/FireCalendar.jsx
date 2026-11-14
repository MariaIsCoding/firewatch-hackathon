
import { useEffect, useState } from 'react'

const monthNames = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
]

function FireCalendar() {
  const [year, setYear] = useState(2025)
  const [month, setMonth] = useState(0)
  const [sensor, setSensor] = useState('MODIS')
  const [selectedDay, setSelectedDay] = useState(null)

  const [dailyData, setDailyData] = useState([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState(false)

  useEffect(() => {
    fetch('/data/firewatch_daily.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Daily dataset not available')
        }
        return response.json()
      })
      .then((data) => {
        setDailyData(data)
        setDataError(false)
      })
      .catch(() => {
        setDataError(true)
      })
      .finally(() => {
        setDataLoading(false)
      })
  }, [])

  const dailyLookup = Object.fromEntries(
    dailyData.map((item) => [
      `${item.sensor}-${item.date}`,
      item.activity_count
    ])
  )

  function getDailyCount(day) {
    const date = [
      year,
      String(month + 1).padStart(2, '0'),
      String(day).padStart(2, '0')
    ].join('-')

    return dailyLookup[`${sensor}-${date}`] ?? null
  }

  // Find the highest daily count in the selected month
  const monthlyCounts = daysInMonth => {
    return Array.from(
      { length: daysInMonth },
      (_, i) => getDailyCount(i + 1)
    ).filter(count => count !== null)
  }

  function getDayColor(day) {
    if (day === null) return undefined

    const count = getDailyCount(day)

    // Missing data stays uncolored
    if (count === null) return undefined

    const counts = monthlyCounts(
      new Date(year, month + 1, 0).getDate()
    )

    const maxCount = Math.max(...counts)

    if (maxCount === 0) return '#334155'

    const intensity = count / maxCount

    if (intensity < 0.2) return '#334155'
    if (intensity < 0.4) return '#78350f'
    if (intensity < 0.6) return '#9a3412'
    if (intensity < 0.8) return '#c2410c'

    return '#ea580c'
  }

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const days = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ]

  function changeMonth(direction) {
    const newDate = new Date(year, month + direction, 1)

    setYear(newDate.getFullYear())
    setMonth(newDate.getMonth())
    setSelectedDay(null)
  }

  return (
    <section className="fire-calendar">
      <h2>📅 Fire Activity Calendar</h2>

    
 
<p>
  This calendar shows how many heat spots NASA satellites
  detected each day. A heat spot is a place where a satellite
  detected unusual heat that may be caused by a fire.
  One wildfire can create many heat spots, so the numbers
  do not tell us how many separate wildfires occurred.
</p>


      <div className="calendar-controls">
        <label>
          Sensor:{' '}
          <select
            value={sensor}
            onChange={(event) => {
              setSensor(event.target.value)
              setSelectedDay(null)
            }}
          >
            <option value="MODIS">MODIS</option>
            <option value="VIIRS">VIIRS</option>
          </select>
        </label>

        <label>
          Year:{' '}
          <select
            value={year}
            onChange={(event) => {
              setYear(Number(event.target.value))
              setSelectedDay(null)
            }}
  
          >
            {Array.from({ length: 12 }, (_, i) => 2015 + i).map(
              (availableYear) => (
                <option key={availableYear} value={availableYear}>
                  {availableYear}
                </option>
              )
            )}
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
    {monthNames.map((monthName, index) => (
      <option key={monthName} value={index}>
        {monthName}
      </option>
    ))}
  </select>
</label>

      </div>

      <div className="calendar-header">
        <button type="button" onClick={() => changeMonth(-1)}>
          ◀ Previous
        </button>

        <h3>{monthNames[month]} {year}</h3>

        <button type="button" onClick={() => changeMonth(1)}>
          Next ▶
        </button>
      </div>

      <div className="calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
          (day) => (
            <div key={day} className="calendar-weekday">
              {day}
            </div>
          )
        )}


{days.map((day, index) => {
  const isMissing = day !== null && getDailyCount(day) === null

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
      disabled={day === null}
      onClick={() => setSelectedDay(day)}
      title={
        isMissing
          ? 'No satellite detection record available'
          : day !== null
            ? `${getDailyCount(day)?.toLocaleString()} satellite detections`
            : ''
      }
    >
      {day}
      {isMissing && <span className="missing-indicator">—</span>}
    </button>
  )
})}

      </div>

      <div className="calendar-legend">

<p className="calendar-missing-note">
  <span className="missing-legend-symbol">—</span>
  No detection record available
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
  The colors compare days within the same month.
  Brighter orange means more heat spots were detected
  that day compared with other days in that month.
  A dashed box means no detection data is available
  for that date, not that there were no fires.
</p>


      {selectedDay && (
        <div className="calendar-details">
          <h3>
            {monthNames[month]} {selectedDay}, {year}
          </h3>

          
<p>Sensor: {sensor}</p>

{dataLoading ? (
  <p>Loading NASA satellite data...</p>
) : dataError ? (
  <p>Daily detection data is not available yet.</p>
) : getDailyCount(selectedDay) === null ? (
  <p>No daily detection record is available for this date.</p>
) : (
  <p>
    <strong>
      {getDailyCount(selectedDay).toLocaleString()}
    </strong>{' '}
    satellite hotspot detections recorded.
  </p>
)}
        </div>
      )}
    </section>
  )
}

export default FireCalendar
