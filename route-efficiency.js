/* Route insertion preserves the relative order of existing stops. */
(function(root) {
  const mapped = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
  function context(trip) {
    if (!trip || !mapped(trip.start) || trip.stops.some(p => !mapped(p))) return null;
    const finish = trip.finish === 'return' ? trip.start : trip.finish === 'last' ? null : trip.finish;
    if (finish && !mapped(finish)) return null;
    return {points: [trip.start, ...trip.stops, ...(finish ? [finish] : [])], slots: trip.stops.length + 1, finish: !!finish};
  }
  function bestInsertion(ctx, candidate, leg) {
    if (!ctx || !mapped(candidate)) return null;
    let best = null;
    for (let i = 0; i < ctx.slots; i++) {
      const a = ctx.points[i], b = ctx.points[i + 1];
      const inbound = leg(a, candidate), outbound = b ? leg(candidate, b) : {mi:0,min:0}, old = b ? leg(a,b) : {mi:0,min:0};
      if (![inbound,outbound,old].every(x => x && Number.isFinite(x.mi) && Number.isFinite(x.min))) continue;
      const option = {index:i, mi:Math.max(0,inbound.mi + outbound.mi - old.mi), min:Math.max(0,inbound.min + outbound.min - old.min)};
      if (!best || option.min < best.min || (option.min === best.min && option.mi < best.mi)) best = option;
    }
    return best;
  }
  function distanceToLine(p, points, distance) {
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[i + 1];
      best = Math.min(best, distance(p,a));
      if (!b) continue;
      const scale = Math.cos(p.lat*Math.PI/180), x = (b.lon-a.lon)*scale, y=b.lat-a.lat;
      const t = Math.max(0,Math.min(1,(((p.lon-a.lon)*scale)*x+(p.lat-a.lat)*y)/(x*x+y*y || 1)));
      best = Math.min(best,distance(p,{lat:a.lat+t*y,lon:a.lon+t*(b.lon-a.lon)}));
    }
    return best;
  }
  root.RouteEfficiency = {mapped,context,bestInsertion,distanceToLine};
  if (typeof module !== 'undefined') module.exports = root.RouteEfficiency;
})(globalThis);
