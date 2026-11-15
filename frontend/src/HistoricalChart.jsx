
import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

function HistoricalChart() {
  const [records, setRecords] = useState([])
  const [sensor, setSensor] = useState('MODIS')
  const [year, setYear] = useState('2025')
  const [selectedMonth, setSelectedMonth] = useState('01')
  const [comparePreviousYear, setComparePreviousYear] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/data/firewatch_historical.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load historical data')
        }
        return response.json()
      })
      .then((data) => {
        setRecords(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const years = [
    ...new Set(records.map((item) => item.month.slice(0, 4)))
  ].sort()

  // Index historical monthly records by satellite and month.
  const recordLookup = new Map(
    records.map((item) => [`${item.sensor}-${item.month}`, item])
  )

  const previousYear = String(Number(year) - 1)

  // Build all twelve months in calendar order.
  // Missing records become gaps instead of shifting the x-axis.
  const chartData = monthNames.map((name, index) => {
    const monthNumber = String(index + 1).padStart(2, '0')

    const current = recordLookup.get(
      `${sensor}-${year}-${monthNumber}`
    )

    const previous = recordLookup.get(
      `${sensor}-${previousYear}-${monthNumber}`
    )

    const previousYearComplete =
      previous?.coverage_status === 'no_date_gaps_detected' &&
      previous.activity_count != null &&
      Number.isFinite(Number(previous.activity_count))

    return {
      month: name,
      activity: current?.activity_count ?? null,
      median: current?.historical_median ?? null,
      status: current?.coverage_status ?? 'unavailable',
      anomaly: current?.anomaly_percent ?? null,
      previousYear: previousYearComplete
        ? Number(previous.activity_count)
        : null,
    }
  })

  const previousYearHasData = chartData.some(
    (item) => item.previousYear !== null
  )

  if (loading) return <p>Loading NASA historical data...</p>
  if (error) return <p>Unable to load chart: {error}</p>

  const selectedRecord = records.find(
    (item) =>
      item.sensor === sensor &&
      item.month === `${year}-${selectedMonth}`
  )

  const formatCount = (value) =>
    value == null ? 'N/A' : Number(value).toLocaleString()

  const formatAnomaly = (value) =>
    value == null
      ? 'N/A'
      : `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}%`

  const flaggedMonths = chartData.filter(
    (item) => item.status !== 'no_date_gaps_detected'
  )

  const flaggedMonthNames = flaggedMonths.map((item) => {
    const index = monthNames.indexOf(item.month)
    return index >= 0
      ? new Date(2000, index, 1).toLocaleString('en-US', {
          month: 'long'
        })
      : item.month
  })

  const formatMonthList = (months) => {
    if (months.length <= 1) return months.join('')
    if (months.length === 2) return months.join(' and ')

    return (
      months.slice(0, -1).join(', ') +
      ', and ' +
      months[months.length - 1]
    )
  }

  const dateGapMonths = chartData
    .filter((item) => item.status === 'date_gaps_detected')
    .map((item) => {
      const index = monthNames.indexOf(item.month)
      return new Date(2000, index, 1).toLocaleString('en-US', {
        month: 'long'
      })
    })

  const partialMonths = chartData
    .filter((item) => item.status === 'partial')
    .map((item) => {
      const index = monthNames.indexOf(item.month)
      return new Date(2000, index, 1).toLocaleString('en-US', {
        month: 'long'
      })
    })

  const downloadCSV = () => {
    const selectedRecords = records.filter(
      (item) =>
        item.sensor === sensor &&
        item.month.startsWith(year)
    )

    const columns = [
      'region',
      'sensor',
      'month',
      'activity_count',
      'historical_median',
      'coverage_status',
      'anomaly_percent'
    ]

    const csvRows = [
      columns.join(','),
      ...selectedRecords.map((record) =>
        columns.map((column) => {
          const value = record[column]

          if (value === null || value === undefined) {
            return ''
          }

          return `"${String(value).replaceAll('"', '""')}"`
        }).join(',')
      )
    ]

    const csv = csvRows.join('\r\n')
    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `FireWatch_${sensor}_${year}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <p>
        Explore monthly global satellite hotspot detections
        and compare them against historical baselines.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label>
          Sensor:{' '}
          <select
            value={sensor}
            onChange={(event) => setSensor(event.target.value)}
          >
            <option value="MODIS">MODIS</option>
            <option value="VIIRS">VIIRS</option>
          </select>
        </label>

        <label>
          Year:{' '}
          <select
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            {years.map((availableYear) => (
              <option key={availableYear} value={availableYear}>
                {availableYear}
              </option>
            ))}
          </select>
        </label>

        <label>
          Month:{' '}
          <select
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
          >
            {monthNames.map((name, index) => (
              <option
                key={name}
                value={String(index + 1).padStart(2, '0')}
              >
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* OPTIONAL PREVIOUS-YEAR COMPARISON */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 16
        }}
      >
        <input
          type="checkbox"
          checked={comparePreviousYear}
          onChange={(event) =>
            setComparePreviousYear(event.target.checked)
          }
        />
        Compare with previous year ({previousYear})
      </label>

      {comparePreviousYear && !previousYearHasData && (
        <p style={{ color: '#fbbf24', fontSize: 14 }}>
          No complete previous-year monthly records are available
          for this satellite selection and year.
        </p>
      )}

      <div style={{ width: '100%', height: 360, marginTop: 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#334155"
            />

            <XAxis dataKey="month" stroke="#cbd5e1" />

            <YAxis
              stroke="#cbd5e1"
              tickFormatter={(value) =>
                `${(value / 1000000).toFixed(1)}M`
              }
            />

            <Tooltip
              formatter={(value) =>
                value == null
                  ? 'Not available'
                  : Number(value).toLocaleString()
              }
              contentStyle={{
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#ffffff',
              }}
            />

            <Legend />

            <Line
              type="monotone"
              dataKey="activity"
              name="Monthly detections"
              stroke="#fb923c"
              strokeWidth={3}
              dot={{ r: 4 }}
              connectNulls={false}
            />

            <Line
              type="monotone"
              dataKey="median"
              name="Historical median"
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="6 4"
              connectNulls={false}
            />

            {comparePreviousYear && (
              <Line
                type="monotone"
                dataKey="previousYear"
                name={`Previous year (${previousYear})`}
                stroke="#a78bfa"
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={{ r: 3 }}
                connectNulls={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="historical-summary">
        <h3>
          Monthly Summary — {monthNames[Number(selectedMonth) - 1]} {year}
        </h3>

        <div className="summary-grid">
          <div className="summary-card">
            <p>Satellite Detections</p>
            <h3>{formatCount(selectedRecord?.activity_count)}</h3>
          </div>

          <div className="summary-card">
            <p>Historical Median</p>
            <h3>{formatCount(selectedRecord?.historical_median)}</h3>
          </div>

          <div className="summary-card">
            <p>Difference From Median</p>
            <h3>
              {selectedRecord?.coverage_status === 'no_date_gaps_detected'
                ? formatAnomaly(selectedRecord?.anomaly_percent)
                : 'N/A'}
            </h3>
          </div>
        </div>

        {/* CHART EXPLANATIONS */}
        <div className="chart-explanation">
          <h3>Understanding This Chart</h3>

          <div className="chart-explanation-item">
            <h4 className="orange-line">
              🟠 Orange Line — Monthly Detections
            </h4>
            <p>
              Shows how many possible fire-related heat spots NASA
              satellites detected each month during the selected year.
              These are satellite detections, not the number of
              individual wildfires.
            </p>
          </div>

          <div className="chart-explanation-item">
            <h4 className="blue-line">
              🔵 Blue Line — Historical Median
            </h4>
            <p>
              Shows the typical number of satellite detections for
              that month based on earlier years, starting in 2012.
              For example, July 2020 is compared with previous Julys,
              not other months in 2020.
            </p>
          </div>

          <div className="chart-explanation-item">
            <h4 style={{ color: '#a78bfa' }}>
              🟣 Purple Line — Previous Year (Optional)
            </h4>
            <p>
              When enabled, shows the same calendar months from the
              preceding year for the selected satellite. For example,
              July 2025 is compared with July 2024. Months with
              incomplete or gap-flagged previous-year coverage are
              omitted from this line rather than treated as zero.
            </p>
          </div>

          <div className="chart-comparison">
            <h4>How to Compare Them</h4>
            <p>
              When the orange line is above the blue line, satellites
              detected more heat spots than usual for that month.
              When it's below, they detected fewer than usual.
            </p>
          </div>

          <p className="chart-explanation-note">
            Historical medians require at least three earlier years
            with eligible data. Months with detected date gaps are
            excluded from the baseline. The current-year monthly
            detections line retains the dataset's existing values;
            check coverage notices before interpreting flagged months.
            The previous-year line only displays months marked as
            having no detected date gaps.
          </p>
        </div>

        <p className="coverage-note">
          Coverage:{' '}
          {selectedRecord?.coverage_status?.replaceAll('_', ' ') ??
            'Unavailable'}
        </p>
      </div>

      <button
        type="button"
        className="download-button"
        onClick={downloadCSV}
      >
        ⬇ Download {sensor} {year} CSV
      </button>

      {flaggedMonths.length > 0 && (
        <div className="coverage-notice">
          <div className="coverage-notice-title">
            ⚠️ Data coverage notice
          </div>

          {dateGapMonths.length > 0 && (
            <p>
              {formatMonthList(dateGapMonths)}{' '}
              {dateGapMonths.length === 1 ? 'has' : 'have'} detected
              date gaps. These months may not be directly comparable.
            </p>
          )}

          {partialMonths.length > 0 && (
            <p>
              {formatMonthList(partialMonths)}{' '}
              {partialMonths.length === 1 ? 'is' : 'are'} partial
              and may not be directly comparable.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default HistoricalChart
