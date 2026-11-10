# Notifications

The hub has no mail server and no push service of its own. It posts an alert to a webhook or to an
[ntfy](https://ntfy.sh) topic, and that is the whole surface: two environment variables, no account,
no state file.

## Two channels

| Variable            | What it posts                                                  |
| ------------------- | -------------------------------------------------------------- |
| `NOTIFY_WEBHOOK`    | One JSON object per alert, to any URL that accepts a POST      |
| `NOTIFY_NTFY`       | The topic URL, as text, with a `Title` and a `Priority` header |
| `NOTIFY_NTFY_TOKEN` | Optional bearer token for a protected topic                    |

```sh
NOTIFY_NTFY=https://ntfy.sh/my-wiim-hub
# or, for a script of your own
NOTIFY_WEBHOOK=https://automation.example/hook/wiim
```

Both can be set. Each alert goes to both, one after the other, and a channel that fails is logged
without silencing the other.

## When it speaks

The twelve diagnostic rules are evaluated on every poll. An alert is sent **when a rule appears**,
not while it stays:

- a rule that is still raised is the same event: it is announced once, however long it lasts;
- a rule that clears and comes back inside the quiet period (`NOTIFY_QUIET_MS`, one hour by default)
  is held: a weak link flapping around its threshold is one fault, not one per flap;
- `NOTIFY_MIN_SEVERITY` (`warn` by default) leaves the four `info` rules out (`ethDrops`,
  `upnpActionsLost`, `eventingDegraded`, `sleepTimer`); set `info` to hear about them too;
- `NOTIFY_RULES` narrows the channel to the rules you name, comma separated and by id:
  `offline,hardwareFault,flashWear`. An unknown name is reported at start, because a typo would
  otherwise look like a rule that never fires.

The four `alert` rules are the ones worth waking someone for: `offline`, `abnormalReboots`,
`crashCounters`, `hardwareFault`.

## What a message says

The webhook body carries the event flat, so a consumer that reads only the title still knows which
rule and which severity it is looking at, and one that wants to check the claim gets the same
evidence lines as the report:

```json
{
  "at": "2026-11-10T12:00:00.000Z",
  "device": "Kitchen",
  "host": "192.168.1.10",
  "rule": "hardwareFault",
  "severity": "alert",
  "title": "Kitchen: hardware fault",
  "message": "A hardware probe reports a fault: soundCardHwError.",
  "evidence": ["getHwErrorInfo: soundCardHwError.pcm5121 = \"1\""]
}
```

ntfy gets the same content as text, with `Title: Kitchen: hardware fault` and a priority that follows
the severity (`high`, `default`, `low`). A player that never answered has no name to report, so the
configured entry becomes the name.

## Nothing is retried, nothing is stored

- A channel that answers outside 2xx, or does not answer within five seconds, is logged and forgotten:
  `wiim-hub: alert refused by webhook (hardwareFault on Kitchen): HTTP 500`. The next occurrence of
  that rule is the retry.
- The open rules and the quiet timestamps live in memory. A restart announces each open rule once
  again, which is the same behaviour as the first start, and the hub keeps writing nothing but the
  host list.

## Trying it

Unplug the player, or point `DEVICE_HOSTS` at an address that answers nothing: the `offline` rule
fires on the first failed poll, which is the shortest path from an empty inbox to a message. The demo
mode sends nothing: it serves the same page over simulated players and has no notifier.
