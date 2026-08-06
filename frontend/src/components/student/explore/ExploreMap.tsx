'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// PR-EXPLORE — the map half of the Explore screen.
//
// Leaflet + OpenStreetMap: no API key, no billing, no account. Adequate for ~90
// pins in one country, and the tiles are the same data the geocoder used.
//
// Loaded via next/dynamic with ssr:false by the parent — Leaflet touches
// `window` at import time and would break the server render otherwise.
//
// CircleMarker rather than the default pin: Leaflet's default icon loads its
// PNGs by a relative URL that breaks under Next's asset pipeline, and the usual
// fix is a brittle bundler shim. A vector marker has no assets to lose, scales
// crisply, and lets "featured" be expressed as colour + size.

export interface MapPin {
  providerId: string;
  providerName: string;
  isFeatured: boolean;
  latitude: number;
  longitude: number;
  programmeCount: number;
  fromNetCostNZD: number | null;
}

// Roughly the whole country, used as the opening view.
const NZ_CENTER: [number, number] = [-41.0, 173.5];

/** Refits the view whenever the pin set changes (a filter narrowed results). */
function FitToPins({ pins }: { pins: MapPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (!pins.length) return;
    if (pins.length === 1) {
      map.setView([pins[0].latitude, pins[0].longitude], 12);
      return;
    }
    const lats = pins.map((p) => p.latitude);
    const lons = pins.map((p) => p.longitude);
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
      { padding: [40, 40], maxZoom: 11 },
    );
  }, [pins, map]);
  return null;
}

export function ExploreMap({
  pins, selectedProviderId, onSelectProvider,
}: {
  pins: MapPin[];
  selectedProviderId: string | null;
  onSelectProvider: (providerId: string | null) => void;
}) {
  // Marker radius reflects how many matching programmes an institution has, so
  // a big provider reads as a bigger opportunity at a glance. Clamped so one
  // 113-programme institution cannot swallow the map.
  const radiusFor = useMemo(() => {
    const max = Math.max(1, ...pins.map((p) => p.programmeCount));
    return (count: number) => 6 + Math.round((Math.min(count, max) / max) * 10);
  }, [pins]);

  return (
    <MapContainer
      center={NZ_CENTER}
      zoom={5}
      scrollWheelZoom
      style={{ height: '100%', width: '100%' }}
      className="rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToPins pins={pins} />
      {pins.map((p) => {
        const selected = p.providerId === selectedProviderId;
        return (
          <CircleMarker
            key={p.providerId}
            center={[p.latitude, p.longitude]}
            radius={radiusFor(p.programmeCount) + (selected ? 4 : 0)}
            pathOptions={{
              color: selected ? '#1e3a5f' : p.isFeatured ? '#c9a961' : '#15a86b',
              weight: selected ? 3 : 2,
              fillColor: selected ? '#1e3a5f' : p.isFeatured ? '#c9a961' : '#15a86b',
              fillOpacity: selected ? 0.85 : 0.55,
            }}
            eventHandlers={{
              click: () => onSelectProvider(selected ? null : p.providerId),
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <span className="font-semibold">{p.providerName}</span>
              <br />
              {p.programmeCount} programme{p.programmeCount === 1 ? '' : 's'}
              {p.fromNetCostNZD != null && <><br />from NZ${p.fromNetCostNZD.toLocaleString()}</>}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
