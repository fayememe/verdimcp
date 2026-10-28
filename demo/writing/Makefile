# Long-running simulation that keeps writing an FSDB.
# Used by scripts/writing-fsdb.sh (NPI live-FSDB behaviour); not part of acceptance.

SYNENV    ?= ../sim/synenv.sh
VCS       ?= $(SYNENV) vcs
SIMV      ?= simv
CYCLES    ?= 2000000
VCS_FLAGS ?= -full64 -sverilog -debug_access+all -Mupdate -j16 -LDFLAGS -Wl,--no-as-needed

.PHONY: all tb simv run clean

all: run

tb: tb_grow.v

tb_grow.v: gen_tb.py
	python3 gen_tb.py > $@

simv: tb_grow.v
	$(VCS) $(VCS_FLAGS) tb_grow.v -l compile.log

run: simv
	./$(SIMV) +cycles=$(CYCLES) | tee sim.log
	ls -lh growing.fsdb

clean:
	rm -rf simv simv.daidir csrc ucli.key tb_grow.v compile.log sim.log growing.fsdb novas* verdiLog
