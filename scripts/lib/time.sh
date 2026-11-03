# ISO 8601 timestamps as epochs, in one place (docs/self-modification.md §9: a rule the
# runtime depends on has one home, and a script keeps it true).
#
# `EPOCH_JQ` is a jq program fragment every reader splices in front of its own filter:
#
#     jq -c --argjson now "$NOW_EPOCH" "$EPOCH_JQ"' [ … (.closes | epoch) … ]'
#
# `epoch` reads `YYYY-MM-DDTHH:MM:SS` with optional fractional seconds and an optional
# `Z`, `+HH:MM`, `+HHMM`, `-HH:MM` or `-HHMM` offset, and returns seconds since the epoch —
# the same instant whatever the offset says. A value it cannot read is `null`, never 0:
# a broken timestamp must not read as "long ago", which would close a vote or expire a
# prototype the moment it was written. Callers treat `null` as "no date", each in its own
# safe direction. `ep` is the older name the monitor uses.
EPOCH_JQ='def epoch:
  if type != "string" then null
  else
    (capture("^(?<d>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\\.[0-9]+)?(?<o>Z|[+-][0-9]{2}:?[0-9]{2})?$") // null) as $m
    | if $m == null then null
      else (($m.d + "Z") | fromdateiso8601? // null) as $t
        | if $t == null then null
          else ($m.o // "Z") as $o
            | if $o == "Z" then $t
              else (($o[0:1]) as $sign
                    | (($o[1:3] | tonumber) * 3600 + (($o | sub("^[+-][0-9]{2}:?"; "")) | tonumber) * 60) as $off
                    | $t - (if $sign == "+" then $off else -$off end))
              end
          end
      end
  end;
def ep: epoch;'
