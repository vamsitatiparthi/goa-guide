import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'

type DayBreakdown = {
  day: number
  date: string
  activitiesCount: number
  estimatedCost: number
}

export default function Booking() {
  const router = useRouter()
  const { tripId } = router.query
  const [itinerary, setItinerary] = useState<any>(null)

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem('goaguide:lastItinerary')
        if (raw) setItinerary(JSON.parse(raw))
      }
    } catch {}
  }, [])

  const summary = useMemo(() => {
    if (!itinerary) return null
    const days = itinerary.itinerary?.length || 0
    const total = itinerary.total_cost || 0
    const perDay: DayBreakdown[] = (itinerary.itinerary || []).map((d: any) => ({
      day: d.day,
      date: d.date,
      activitiesCount: (d.activities || []).length,
      estimatedCost: d.estimated_cost || 0,
    }))
    const avgPerDay = days ? Math.round(total / days) : 0
    return {
      days,
      total,
      perDay,
      avgPerDay,
    }
  }, [itinerary])

  const hotelUrl = 'https://www.google.com/travel/hotels/Goa'
  const transportUrl = 'https://www.skyscanner.co.in/transport/flights-to/goa/'

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Booking Summary</h1>

        <div className="bg-white p-6 rounded-xl shadow-sm border mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <div className="text-gray-500 text-sm">Trip ID</div>
              <div className="font-semibold break-all">{tripId}</div>
            </div>
            <div>
              <div className="text-gray-500 text-sm">Total Days</div>
              <div className="font-semibold">{summary?.days ?? '-'}</div>
            </div>
            <div>
              <div className="text-gray-500 text-sm">Total Estimated Cost</div>
              <div className="font-semibold">₹{summary?.total?.toLocaleString?.() ?? '-'}</div>
            </div>
            <div>
              <div className="text-gray-500 text-sm">Avg. Per Day</div>
              <div className="font-semibold">₹{summary?.avgPerDay?.toLocaleString?.() ?? '-'}</div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border mb-6">
          <h2 className="text-xl font-semibold mb-4">Per-day cost & activity breakdown</h2>
          <div className="divide-y">
            {summary?.perDay?.map((d) => (
              <div key={d.day} className="py-3 flex items-center justify-between">
                <div className="text-gray-800 font-medium">Day {d.day} — {new Date(d.date).toLocaleDateString()}</div>
                <div className="text-gray-600">{d.activitiesCount} activities</div>
                <div className="text-orange-600 font-semibold">₹{d.estimatedCost.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border mb-6">
          <h2 className="text-xl font-semibold mb-4">Vendors</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <a
              href={hotelUrl}
              target="_blank"
              rel="noreferrer"
              className="block border rounded-lg p-4 hover:shadow transition bg-orange-50 border-orange-200"
            >
              <div className="font-semibold text-orange-700">Find Hotels</div>
              <div className="text-sm text-orange-900/80">Open Google Hotels for Goa. Choose dates based on your itinerary.</div>
            </a>
            <a
              href={transportUrl}
              target="_blank"
              rel="noreferrer"
              className="block border rounded-lg p-4 hover:shadow transition bg-blue-50 border-blue-200"
            >
              <div className="font-semibold text-blue-700">Find Transport</div>
              <div className="text-sm text-blue-900/80">Open Skyscanner for flights to Goa. You can also search trains/buses.</div>
            </a>
          </div>
        </div>

        <div className="bg-gradient-to-r from-orange-500 to-pink-500 text-white p-6 rounded-xl text-center space-y-3">
          <h3 className="text-xl font-bold mb-2">Talk to a Travel Specialist</h3>
          <p className="opacity-90">We&apos;ll help you finalize bookings, get the best rates and make last-minute tweaks.</p>
          <a
            href={`mailto:bookings@goaguide.example?subject=GoaGuide%20Booking%20Request%20-%20Trip%20${tripId}&body=Hi%20GoaGuide%20Team,%0D%0A%0D%0APlease%20help%20me%20book%20my%20trip.%20Trip%20ID:%20${tripId}.%0D%0ATotal%20days:%20${summary?.days}.%0D%0ATotal%20estimated%20cost:%20₹${summary?.total}.%0D%0A%0D%0AThanks!`}
            className="inline-block bg-white text-orange-600 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
          >
            Email Us to Book
          </a>
        </div>
      </div>
    </div>
  )
}
