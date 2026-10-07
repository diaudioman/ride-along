/* Route insertion preserves the relative order of existing stops. */
(function (root) {
  const mapped = (p) =>
    p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180;
  function context(trip) {
    if (
      !trip ||
      !mapped(trip.start) ||
      trip.stops.filter((p) => !p.skipped).some((p) => !mapped(p))
    )
      return null;
    const finish =
      trip.finish === "return"
        ? trip.start
        : trip.finish === "last"
          ? null
          : trip.finish;
    if (finish && !mapped(finish)) return null;
    const active = trip.stops.filter((p) => !p.skipped);
    return {
      points: [trip.start, ...active, ...(finish ? [finish] : [])],
      slots: active.length + 1,
      indices: [
        ...trip.stops.flatMap((p, i) => (p.skipped ? [] : [i])),
        trip.stops.length,
      ],
      finish: !!finish,
    };
  }
  function bestInsertion(ctx, candidate, leg) {
    if (!ctx || !mapped(candidate)) return null;
    let best = null;
    for (let i = 0; i < ctx.slots; i++) {
      const a = ctx.points[i],
        b = ctx.points[i + 1];
      const inbound = leg(a, candidate),
        outbound = b ? leg(candidate, b) : { mi: 0, min: 0 },
        old = b ? leg(a, b) : { mi: 0, min: 0 };
      if (
        ![inbound, outbound, old].every(
          (x) => x && Number.isFinite(x.mi) && Number.isFinite(x.min),
        )
      )
        continue;
      const option = {
        index: ctx.indices?.[i] ?? i,
        mi: Math.max(0, inbound.mi + outbound.mi - old.mi),
        min: Math.max(0, inbound.min + outbound.min - old.min),
      };
      if (
        !best ||
        option.min < best.min ||
        (option.min === best.min && option.mi < best.mi)
      )
        best = option;
    }
    return best;
  }
  function distanceToLine(p, points, distance) {
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[i + 1];
      best = Math.min(best, distance(p, a));
      if (!b) continue;
      const scale = Math.cos((p.lat * Math.PI) / 180),
        x = (b.lon - a.lon) * scale,
        y = b.lat - a.lat;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.lon - a.lon) * scale * x + (p.lat - a.lat) * y) /
            (x * x + y * y || 1),
        ),
      );
      best = Math.min(
        best,
        distance(p, { lat: a.lat + t * y, lon: a.lon + t * (b.lon - a.lon) }),
      );
    }
    return best;
  }
  // Held–Karp finds the minimum directed travel cost for up to 12 stops.
  // Larger itineraries use insertion and relocation, never worsening the input.
  function optimalOrder(start, stops, finish, leg) {
    if (stops.length < 2) return [...stops];
    const cost = (a, b) => (b ? (leg(a, b)?.min ?? Infinity) : 0);
    const total = (order) =>
      order.reduce((sum, p, i) => sum + cost(i ? order[i - 1] : start, p), 0) +
      cost(order.at(-1), finish);
    const n = stops.length;
    if (n <= 12) {
      const dp = Array.from({ length: 1 << n }, () => Array(n).fill(Infinity));
      const prev = Array.from({ length: 1 << n }, () => Array(n).fill(-1));
      for (let i = 0; i < n; i++) dp[1 << i][i] = cost(start, stops[i]);
      for (let mask = 1; mask < 1 << n; mask++)
        for (let i = 0; i < n; i++) {
          if (!(mask & (1 << i)) || !Number.isFinite(dp[mask][i])) continue;
          for (let j = 0; j < n; j++)
            if (!(mask & (1 << j))) {
              const next = mask | (1 << j),
                value = dp[mask][i] + cost(stops[i], stops[j]);
              if (value < dp[next][j]) {
                dp[next][j] = value;
                prev[next][j] = i;
              }
            }
        }
      let mask = (1 << n) - 1,
        last = -1,
        best = Infinity;
      for (let i = 0; i < n; i++) {
        const value = dp[mask][i] + cost(stops[i], finish);
        if (value < best) {
          best = value;
          last = i;
        }
      }
      if (last < 0) return [...stops];
      const out = [];
      while (last >= 0) {
        out.push(stops[last]);
        const before = prev[mask][last];
        mask ^= 1 << last;
        last = before;
      }
      return out.reverse();
    }
    let order = [...stops],
      best = total(order);
    for (let pass = 0; pass < 8; pass++) {
      let improved = false;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const next = [...order],
            [p] = next.splice(i, 1);
          next.splice(j, 0, p);
          const value = total(next);
          if (value + 0.001 < best) {
            order = next;
            best = value;
            improved = true;
          }
        }
      if (!improved) break;
    }
    return order;
  }
  root.RouteEfficiency = {
    mapped,
    context,
    bestInsertion,
    distanceToLine,
    optimalOrder,
  };
  if (typeof module !== "undefined") module.exports = root.RouteEfficiency;
})(globalThis);
