/* Minimal headless Verdi command-client PoC (libnclt) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "cmdclt.h"

static void EventCB(char* event, void* clientData, char* callData) {
    (void)clientData;
    printf("EVENT\t%s\t%s\n", event, callData ? callData : "");
    fflush(stdout);
}

int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <port> [--hold <sec>] <cmd> [cmd...]\n", argv[0]);
        return 64;
    }
    int port = atoi(argv[1]);
    int hold = 0;
    int first = 2;
    if (argc >= 5 && strcmp(argv[2], "--hold") == 0) {
        hold = atoi(argv[3]);
        first = 4;
    }
    CMDCLT c = CmdCltCreate(1);
    if (!CmdCltConnect(c, port, NULL, 20)) {
        fprintf(stderr, "connect to port %d failed\n", port);
        return 2;
    }
    CmdCltAddEventCallback(c, (char*)"AllEvents", (CmdCltEventCB)EventCB, NULL);
    int rc = 0;
    for (int i = first; i < argc; i++) {
        char* rv = NULL;
        char ok = CmdCltCallCommand(c, argv[i], 0, &rv);
        printf("%s\t%s\t%s\n", ok ? "OK" : "ERR", argv[i], rv ? rv : "(null)");
        fflush(stdout);
        CmdCltCheckForEvents(c);
        if (!ok) rc = 1;
    }
    if (hold > 0) {
        printf("HOLD\t%d\n", hold);
        fflush(stdout);
        for (int t = 0; t < hold * 5; t++) {
            usleep(200000);
            CmdCltCheckForEvents(c);
        }
        printf("HOLD_END\n");
        fflush(stdout);
    }
    CmdCltDestroy(c);
    return rc;
}
