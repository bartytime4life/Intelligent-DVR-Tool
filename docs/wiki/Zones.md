# Draw rules on a camera still

[Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook#7-draw-zones) · [Recognition details](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details#zones-from-camera-images) · [Facility planning](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning)

![Choose the correct still, draw a region and review its class/threshold/dwell, then export analyzer rules.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/zones.svg)

![Actual Zones editor using a generated flat-color still; the rectangle is a planning example.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/zones.jpg)

*No real camera image or successful detection is implied.*

## Make one useful zone

1. Capture a still deliberately from Monitor, choose a matched Recognition frame,
   or open an approved local image. Use the camera view the rule will analyze.
2. Open **Zones** and select the intended camera plan. For an incoming still, press **Use for Plan …**. Draw the image region and give the rule a useful name.
3. Choose the class and review its threshold, dwell and max-gap behavior. The
   rule describes class presence in a region; it does not identify a person or
   understand authorization or intent.
4. Save the browser rule or **Export analyzer rules** for the local analyzer.
   Add that file to a reviewed local catalog and restart/reconnect as required.
5. Analyze an approved clip from the same view and inspect its observations.

## Keep the coordinate systems straight

| You are editing | Coordinates | What it means |
| --- | --- | --- |
| A camera-image zone | Normalized full-frame image coordinates | Where a detection may satisfy a class-presence rule |
| A room or building | Facility plan dimensions and polygons | Proposed physical layout |
| Camera coverage | Estimated ground-plane planning geometry | A planning estimate, not a measured view |

Moving or re-aiming a camera can invalidate its image zone. An imported still
does not calibrate map coverage automatically. Export the rules separately from
the facility plan, and preserve the source-view context with your test evidence.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/zones.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
