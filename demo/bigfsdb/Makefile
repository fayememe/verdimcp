# Synthetic large-FSDB generator for NPI P1 measurements.
# Not part of the demo/CI; run manually.

SYNENV      ?= ../sim/synenv.sh
VCS         ?= $(SYNENV) vcs
SIMV        ?= simv
FSDB        ?= big.fsdb
CYCLES      ?= 1000000
VCS_FLAGS   ?= -full64 -sverilog -debug_access+all -Mupdate -j16 -LDFLAGS -Wl,--no-as-needed

.PHONY: all clean tb force

all: $(FSDB)

tb: tb_big.v

tb_big.v: gen_tb.py
	python3 gen_tb.py > $@

$(SIMV): tb_big.v
	$(VCS) $(VCS_FLAGS) tb_big.v -l compile.log

$(FSDB): $(SIMV) force
	./$(SIMV) +cycles=$(CYCLES) | tee sim.log
	ls -lh $(FSDB)

force:

clean:
	rm -rf $(SIMV) $(SIMV).daidir csrc ucli.key tb_big.v compile.log sim.log $(FSDB)
